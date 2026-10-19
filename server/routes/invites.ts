import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { imageUrl } from "../lib/images.js";
import { inviteSchema, inviteActionSchema } from "../../shared/validation.js";
import {
  ah,
  isElevated,
  requireAuth,
  requireMember,
  zodMessage,
  type AuthedRequest,
} from "../lib/http.js";

// Mounted at /api.
export const invitesRouter = Router();

const publicUser = (u: { id: string; name: string; avatarVer?: string | null }) => ({
  id: u.id,
  name: u.name,
  avatar: imageUrl("u", u.id, u.avatarVer),
});

// Pending invites addressed to a user (shared by GET /invites and /api/home).
export async function pendingInvitesFor(userId: string) {
  const invites = await prisma.invite.findMany({
    where: { inviteeId: userId, status: "pending" },
    select: {
      id: true,
      createdAt: true,
      group: { select: { id: true, name: true, emoji: true, thumbVer: true } },
      invitedBy: { select: { id: true, name: true, avatarVer: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return invites.map((i) => ({
    id: i.id,
    createdAt: i.createdAt,
    group: { id: i.group.id, name: i.group.name, emoji: i.group.emoji, thumbnail: imageUrl("g", i.group.id, i.group.thumbVer) },
    invitedBy: publicUser(i.invitedBy),
  }));
}

// GET /api/invites — pending invites addressed to the current user.
invitesRouter.get(
  "/invites",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    return res.json({ invites: await pendingInvitesFor(r.session.userId) });
  })
);

// POST /api/invites/:inviteId — accept or decline an invite addressed to me.
invitesRouter.post(
  "/invites/:inviteId",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = inviteActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const invite = await prisma.invite.findUnique({
      where: { id: req.params.inviteId },
      select: { id: true, groupId: true, inviteeId: true, status: true },
    });
    if (!invite || invite.inviteeId !== r.session.userId) {
      return res.status(404).json({ error: "Invite not found" });
    }
    if (invite.status !== "pending") {
      return res.status(409).json({ error: "This invite was already handled." });
    }

    if (parsed.data.action === "accept") {
      // Create the membership (ignore if somehow already a member) and mark accepted.
      await prisma.$transaction([
        prisma.membership.upsert({
          where: { groupId_userId: { groupId: invite.groupId, userId: r.session.userId } },
          create: { groupId: invite.groupId, userId: r.session.userId, role: "member" },
          update: {},
        }),
        prisma.invite.update({
          where: { id: invite.id },
          data: { status: "accepted", resolvedAt: new Date() },
        }),
      ]);
      return res.json({ ok: true, groupId: invite.groupId });
    }

    await prisma.invite.update({
      where: { id: invite.id },
      data: { status: "declined", resolvedAt: new Date() },
    });
    return res.json({ ok: true });
  })
);

// GET /api/groups/:groupId/invites — pending invites for a group (members only).
invitesRouter.get(
  "/groups/:groupId/invites",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const invites = await prisma.invite.findMany({
      where: { groupId: req.params.groupId, status: "pending" },
      select: {
        id: true,
        createdAt: true,
        invitee: { select: { id: true, name: true, avatarVer: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({
      invites: invites.map((i) => ({
        id: i.id,
        createdAt: i.createdAt,
        invitee: publicUser(i.invitee),
      })),
    });
  })
);

// POST /api/groups/:groupId/invites — invite an existing user by name.
invitesRouter.post(
  "/groups/:groupId/invites",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    if (!isElevated(r.membershipRole)) {
      return res.status(403).json({ error: "Only owners and moderators can invite people." });
    }
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const groupId = req.params.groupId;
    const nameKey = parsed.data.name.toLowerCase();

    const invitee = await prisma.user.findUnique({
      where: { nameKey },
      select: { id: true, name: true, avatarVer: true },
    });
    if (!invitee) {
      return res.status(404).json({
        error: `No user named "${parsed.data.name}". They need to log in once first.`,
      });
    }
    if (invitee.id === r.session.userId) {
      return res.status(400).json({ error: "You're already in this group." });
    }

    const already = await prisma.membership.findUnique({
      where: { groupId_userId: { groupId, userId: invitee.id } },
      select: { id: true },
    });
    if (already) {
      return res.status(409).json({ error: `${invitee.name} is already a member.` });
    }

    const pending = await prisma.invite.findFirst({
      where: { groupId, inviteeId: invitee.id, status: "pending" },
      select: { id: true },
    });
    if (pending) {
      return res.status(409).json({ error: `${invitee.name} already has a pending invite.` });
    }

    const invite = await prisma.invite.create({
      data: {
        groupId,
        inviteeId: invitee.id,
        invitedById: r.session.userId,
      },
      select: { id: true, createdAt: true },
    });
    return res.status(201).json({
      invite: { id: invite.id, createdAt: invite.createdAt, invitee: publicUser(invitee) },
    });
  })
);
