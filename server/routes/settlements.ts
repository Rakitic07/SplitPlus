import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { settlementSchema, settlementActionSchema } from "../../shared/validation.js";
import { ah, requireAuth, requireMember, zodMessage, type AuthedRequest } from "../lib/http.js";

// Mounted at /api.
export const settlementsRouter = Router();

const pub = (u: { id: string; name: string; avatar?: string | null }) => ({
  id: u.id,
  name: u.name,
  avatar: u.avatar ?? null,
});

const SEL = {
  id: true,
  groupId: true,
  amount: true,
  note: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
  from: { select: { id: true, name: true, avatar: true } },
  to: { select: { id: true, name: true, avatar: true } },
} as const;

type SettlementRow = {
  id: string;
  groupId: string;
  amount: number;
  note: string | null;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  from: { id: string; name: string; avatar: string | null };
  to: { id: string; name: string; avatar: string | null };
};

function toDto(s: SettlementRow, meId: string, hasThumbnail: boolean, thumbnail?: string | null) {
  return {
    id: s.id,
    groupId: s.groupId,
    from: pub(s.from),
    to: pub(s.to),
    amount: s.amount,
    note: s.note,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    resolvedAt: s.resolvedAt ? s.resolvedAt.toISOString() : null,
    hasThumbnail,
    ...(thumbnail !== undefined ? { thumbnail } : {}),
    incoming: s.to.id === meId,
  };
}

// Pending settlements awaiting a user's approval across every group. Shared by
// GET /settlements/incoming and the combined /api/home endpoint.
export async function incomingSettlementsFor(userId: string) {
  const rows = await prisma.settlement.findMany({
    where: { toId: userId, status: "pending" },
    select: { ...SEL, group: { select: { id: true, name: true, emoji: true, currency: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((s) => ({
    ...toDto(s as SettlementRow, userId, false),
    group: s.group,
  }));
}

// All settlements in a group (with a flag for which carry a proof image).
// Shared by GET /groups/:id/settlements and the combined bootstrap endpoint.
export async function listSettlementsFor(groupId: string, meId: string) {
  const [rows, withThumbs] = await prisma.$transaction([
    prisma.settlement.findMany({
      where: { groupId },
      orderBy: { createdAt: "desc" },
      select: SEL,
    }),
    prisma.settlement.findMany({
      where: { groupId, thumbnail: { not: null } },
      select: { id: true },
    }),
  ]);
  const thumbIds = new Set(withThumbs.map((s) => s.id));
  return rows.map((s) => toDto(s as SettlementRow, meId, thumbIds.has(s.id)));
}

// GET /api/settlements/incoming — pending settlements awaiting MY approval
// across every group (drives the home inbox badge).
settlementsRouter.get(
  "/settlements/incoming",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    return res.json({ settlements: await incomingSettlementsFor(r.session.userId) });
  })
);

// GET /api/groups/:groupId/settlements — all settlements in a group.
settlementsRouter.get(
  "/groups/:groupId/settlements",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    return res.json({
      settlements: await listSettlementsFor(req.params.groupId, r.session.userId),
    });
  })
);

// GET /api/groups/:groupId/settlements/:id — one settlement WITH proof image.
settlementsRouter.get(
  "/groups/:groupId/settlements/:settlementId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const s = await prisma.settlement.findFirst({
      where: { id: req.params.settlementId, groupId: req.params.groupId },
      select: { ...SEL, thumbnail: true },
    });
    if (!s) return res.status(404).json({ error: "Settlement not found" });
    const { thumbnail, ...rest } = s as SettlementRow & { thumbnail: string | null };
    return res.json({
      settlement: toDto(rest as SettlementRow, r.session.userId, !!thumbnail, thumbnail),
    });
  })
);

// POST /api/groups/:groupId/settlements — record a payment I made (pending).
settlementsRouter.post(
  "/groups/:groupId/settlements",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = settlementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const groupId = req.params.groupId;
    const { toId, amount, note, thumbnail } = parsed.data;
    if (toId === r.session.userId) {
      return res.status(400).json({ error: "You can't settle with yourself." });
    }
    const recipient = await prisma.membership.findUnique({
      where: { groupId_userId: { groupId, userId: toId } },
      select: { id: true },
    });
    if (!recipient) {
      return res.status(400).json({ error: "That person isn't in this group." });
    }

    const s = await prisma.settlement.create({
      data: {
        groupId,
        fromId: r.session.userId,
        toId,
        amount,
        note: note || null,
        thumbnail: thumbnail || null,
        status: "pending",
      },
      select: SEL,
    });
    return res.status(201).json({ settlement: toDto(s as SettlementRow, r.session.userId, !!thumbnail) });
  })
);

// POST /api/groups/:groupId/settlements/:id — recipient approves/declines.
settlementsRouter.post(
  "/groups/:groupId/settlements/:settlementId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = settlementActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const s = await prisma.settlement.findFirst({
      where: { id: req.params.settlementId, groupId: req.params.groupId },
      select: { id: true, toId: true, status: true },
    });
    if (!s) return res.status(404).json({ error: "Settlement not found" });
    if (s.toId !== r.session.userId) {
      return res.status(403).json({ error: "Only the person who received the money can confirm it." });
    }
    if (s.status !== "pending") {
      return res.status(409).json({ error: "This payment was already handled." });
    }

    const status = parsed.data.action === "approve" ? "approved" : "declined";
    const updated = await prisma.settlement.update({
      where: { id: s.id },
      data: { status, resolvedAt: new Date() },
      select: SEL,
    });
    return res.json({ settlement: toDto(updated as SettlementRow, r.session.userId, false) });
  })
);
