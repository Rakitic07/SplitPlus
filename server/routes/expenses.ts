import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { expenseSchema } from "../../shared/validation.js";
import { ah, requireAuth, requireMember, zodMessage, type AuthedRequest } from "../lib/http.js";
import { computeShares, type ShareInput } from "../../shared/split.js";

// Mounted at /api.
export const expensesRouter = Router();

const pub = (u: { id: string; name: string; avatar?: string | null }) => ({
  id: u.id,
  name: u.name,
  avatar: u.avatar ?? null,
});

type ExpenseRow = {
  id: string;
  groupId: string;
  title: string;
  category: string;
  amount: number;
  date: Date;
  notes: string | null;
  splitMode: string;
  createdAt: Date;
  paidBy: { id: string; name: string; avatar: string | null };
  createdBy: { id: string; name: string; avatar: string | null };
  shares: { userId: string; amount: number; user: { name: string } }[];
};

function toDto(e: ExpenseRow, hasThumbnail: boolean, thumbnail?: string | null) {
  return {
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    category: e.category,
    amount: e.amount,
    date: e.date.toISOString(),
    notes: e.notes,
    splitMode: e.splitMode,
    createdAt: e.createdAt.toISOString(),
    paidBy: pub(e.paidBy),
    createdBy: pub(e.createdBy),
    hasThumbnail,
    ...(thumbnail !== undefined ? { thumbnail } : {}),
    shares: e.shares.map((s) => ({ userId: s.userId, name: s.user.name, amount: s.amount })),
  };
}

const ROW_SELECT = {
  id: true,
  groupId: true,
  title: true,
  category: true,
  amount: true,
  date: true,
  notes: true,
  splitMode: true,
  createdAt: true,
  paidBy: { select: { id: true, name: true, avatar: true } },
  createdBy: { select: { id: true, name: true, avatar: true } },
  shares: { select: { userId: true, amount: true, user: { select: { name: true } } } },
} as const;

async function groupMemberIds(groupId: string): Promise<Set<string>> {
  const members = await prisma.membership.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return new Set(members.map((m) => m.userId));
}

// List a group's expenses (no heavy thumbnails in the payload). Shared by
// GET /groups/:id/expenses and the combined bootstrap endpoint.
export async function listExpensesFor(groupId: string) {
  const [rows, withThumbs] = await prisma.$transaction([
    prisma.expense.findMany({
      where: { groupId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: ROW_SELECT,
    }),
    prisma.expense.findMany({
      where: { groupId, thumbnail: { not: null } },
      select: { id: true },
    }),
  ]);
  const thumbIds = new Set(withThumbs.map((e) => e.id));
  return rows.map((e) => toDto(e as ExpenseRow, thumbIds.has(e.id)));
}

// GET /api/groups/:groupId/expenses — list (no heavy thumbnails in the payload).
expensesRouter.get(
  "/groups/:groupId/expenses",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    return res.json({ expenses: await listExpensesFor(req.params.groupId) });
  })
);

// GET /api/groups/:groupId/expenses/:expenseId — one expense WITH its thumbnail.
expensesRouter.get(
  "/groups/:groupId/expenses/:expenseId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const e = await prisma.expense.findFirst({
      where: { id: req.params.expenseId, groupId: req.params.groupId },
      select: { ...ROW_SELECT, thumbnail: true },
    });
    if (!e) return res.status(404).json({ error: "Expense not found" });
    const { thumbnail, ...rest } = e as ExpenseRow & { thumbnail: string | null };
    return res.json({ expense: toDto(rest as ExpenseRow, !!thumbnail, thumbnail) });
  })
);

// POST /api/groups/:groupId/expenses — create; shares are computed server-side.
expensesRouter.post(
  "/groups/:groupId/expenses",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = expenseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const groupId = req.params.groupId;
    const d = parsed.data;
    const memberIds = await groupMemberIds(groupId);

    if (!memberIds.has(d.paidById)) {
      return res.status(400).json({ error: "The payer must be a member of this group." });
    }
    const inputs: ShareInput[] = d.shares.filter((s) => memberIds.has(s.userId));
    const computed = computeShares(d.amount, d.splitMode, inputs);
    if (computed.length === 0) {
      return res.status(400).json({ error: "Add at least one participant." });
    }

    const created = await prisma.expense.create({
      data: {
        groupId,
        title: d.title,
        category: d.category,
        amount: d.amount,
        paidById: d.paidById,
        createdById: r.session.userId,
        date: new Date(d.date),
        notes: d.notes || null,
        splitMode: d.splitMode,
        thumbnail: d.thumbnail || null,
        shares: { create: computed.map((s) => ({ userId: s.userId, amount: s.amount })) },
      },
      select: ROW_SELECT,
    });
    return res.status(201).json({ expense: toDto(created as ExpenseRow, !!d.thumbnail) });
  })
);

// PATCH /api/groups/:groupId/expenses/:expenseId — recompute shares on edit.
expensesRouter.patch(
  "/groups/:groupId/expenses/:expenseId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const parsed = expenseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const groupId = req.params.groupId;
    const expenseId = req.params.expenseId;
    const existing = await prisma.expense.findFirst({
      where: { id: expenseId, groupId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    const d = parsed.data;
    const memberIds = await groupMemberIds(groupId);
    if (!memberIds.has(d.paidById)) {
      return res.status(400).json({ error: "The payer must be a member of this group." });
    }
    const inputs: ShareInput[] = d.shares.filter((s) => memberIds.has(s.userId));
    const computed = computeShares(d.amount, d.splitMode, inputs);

    // Replace shares wholesale (simplest correct update).
    const [, updated] = await prisma.$transaction([
      prisma.expenseShare.deleteMany({ where: { expenseId } }),
      prisma.expense.update({
        where: { id: expenseId },
        data: {
          title: d.title,
          category: d.category,
          amount: d.amount,
          paidById: d.paidById,
          date: new Date(d.date),
          notes: d.notes || null,
          splitMode: d.splitMode,
          thumbnail: d.thumbnail || null,
          shares: { create: computed.map((s) => ({ userId: s.userId, amount: s.amount })) },
        },
        select: ROW_SELECT,
      }),
    ]);
    return res.json({ expense: toDto(updated as ExpenseRow, !!d.thumbnail) });
  })
);

// DELETE /api/groups/:groupId/expenses/:expenseId
expensesRouter.delete(
  "/groups/:groupId/expenses/:expenseId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const existing = await prisma.expense.findFirst({
      where: { id: req.params.expenseId, groupId: req.params.groupId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Expense not found" });
    await prisma.expense.delete({ where: { id: req.params.expenseId } });
    return res.json({ ok: true });
  })
);
