import { randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import {
  ah,
  isElevated,
  requireAuth,
  requireMember,
  type AuthedRequest,
} from "../lib/http.js";

// Mounted at /api.
export const joinRouter = Router();

// An opaque, unguessable capability token (~144 bits of entropy). Anyone holding
// it can join the group after authenticating — same trust model as a WhatsApp
// group invite link — so it must be impossible to guess or enumerate.
function newToken(): string {
  return randomBytes(18).toString("base64url");
}

// Fetch (creating if missing) a group's join token. Persisted so the same link
// keeps working until it's explicitly rotated.
async function ensureJoinToken(groupId: string): Promise<string> {
  const existing = await prisma.group.findUnique({
    where: { id: groupId },
    select: { joinToken: true },
  });
  if (existing?.joinToken) return existing.joinToken;
  const token = newToken();
  await prisma.group.update({ where: { id: groupId }, data: { joinToken: token } });
  return token;
}

// GET /api/join/:token — public preview of the group behind a join link. No auth
// required so the invitee can see WHAT they're joining before they sign in. Only
// exposes the bare minimum (name, emoji, member count) — never the expenses or
// member list.
joinRouter.get(
  "/join/:token",
  ah(async (req, res) => {
    const token = req.params.token;
    const group = await prisma.group.findUnique({
      where: { joinToken: token },
      select: { id: true, name: true, emoji: true, _count: { select: { members: true } } },
    });
    if (!group) return res.status(404).json({ error: "This invite link is invalid or has expired." });
    return res.json({
      group: { id: group.id, name: group.name, emoji: group.emoji, memberCount: group._count.members },
    });
  })
);

// POST /api/join/:token — the signed-in user joins the group the link points to.
// Idempotent: re-joining is a no-op. Also resolves any matching pending invite so
// the invitee doesn't keep a stale "waiting" entry on their home screen.
joinRouter.post(
  "/join/:token",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const token = req.params.token;
    const me = r.session.userId;

    const group = await prisma.group.findUnique({
      where: { joinToken: token },
      select: { id: true, name: true },
    });
    if (!group) return res.status(404).json({ error: "This invite link is invalid or has expired." });

    const already = await prisma.membership.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: me } },
      select: { id: true },
    });

    if (!already) {
      await prisma.$transaction([
        prisma.membership.create({
          data: { groupId: group.id, userId: me, role: "member" },
        }),
        prisma.invite.updateMany({
          where: { groupId: group.id, inviteeId: me, status: "pending" },
          data: { status: "accepted", resolvedAt: new Date() },
        }),
      ]);
    }

    return res.json({ ok: true, groupId: group.id, alreadyMember: Boolean(already) });
  })
);

// GET /api/groups/:groupId/join-link — the shareable link token for a group
// (members only). Created on first request so groups made before this feature
// still get a link on demand.
joinRouter.get(
  "/groups/:groupId/join-link",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const token = await ensureJoinToken(req.params.groupId);
    return res.json({ token });
  })
);

// POST /api/groups/:groupId/join-link/rotate — owner/moderator regenerates the
// token, instantly invalidating every previously shared link.
joinRouter.post(
  "/groups/:groupId/join-link/rotate",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    if (!isElevated(r.membershipRole)) {
      return res.status(403).json({ error: "Only owners and moderators can reset the invite link." });
    }
    const token = newToken();
    await prisma.group.update({ where: { id: req.params.groupId }, data: { joinToken: token } });
    return res.json({ token });
  })
);
