import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import {
  groupCreateSchema,
  groupPatchSchema,
  roleActionSchema,
} from "../../shared/validation.js";
import {
  ah,
  isElevated,
  requireAuth,
  requireMember,
  zodMessage,
  type AuthedRequest,
  type MemberRole,
} from "../lib/http.js";
import { computeBalances, simplifyDebts } from "../../shared/balances.js";
import { round2 } from "../../shared/split.js";
import type { PublicUser } from "../../shared/types.js";
import { listExpensesFor } from "./expenses.js";
import { listSettlementsFor } from "./settlements.js";

export const groupsRouter = Router();

const publicUser = (u: { id: string; name: string; avatar?: string | null }): PublicUser => ({
  id: u.id,
  name: u.name,
  avatar: u.avatar ?? null,
});

// Load full net balances (and members) for a group.
async function loadBalances(groupId: string) {
  const [members, expenses, settlements] = await Promise.all([
    prisma.membership.findMany({
      where: { groupId },
      select: { role: true, user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.expense.findMany({
      where: { groupId },
      select: { paidById: true, amount: true, shares: { select: { userId: true, amount: true } } },
    }),
    prisma.settlement.findMany({
      where: { groupId, status: "approved" },
      select: { fromId: true, toId: true, amount: true },
    }),
  ]);

  const memberUsers: PublicUser[] = members.map((m) => publicUser(m.user));
  const balances = computeBalances(memberUsers, expenses, settlements);
  return { members, balances };
}

// Every group a user belongs to, with *their* net per group. Doing one
// loadBalances() per group is a 3×N query fan-out that's fine on local SQLite
// but crushes a remote Postgres (each query is a network round-trip). Instead,
// batch three queries across ALL the user's groups and fold them in memory →
// the dashboard is a constant ~4 queries regardless of how many groups you're
// in. Shared by GET /groups and the combined /api/home endpoint.
export async function listGroupsFor(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: {
      role: true,
      group: {
        select: {
          id: true,
          name: true,
          emoji: true,
          thumbnail: true,
          currency: true,
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  const me = userId;
  const groupIds = memberships.map((m) => m.group.id);

  const net = new Map<string, number>();
  for (const id of groupIds) net.set(id, 0);

  if (groupIds.length > 0) {
    const [myPaid, myShares, mySettlements] = await prisma.$transaction([
      prisma.expense.findMany({
        where: { groupId: { in: groupIds }, paidById: me },
        select: { groupId: true, amount: true },
      }),
      prisma.expenseShare.findMany({
        where: { userId: me, expense: { groupId: { in: groupIds } } },
        select: { amount: true, expense: { select: { groupId: true } } },
      }),
      prisma.settlement.findMany({
        where: {
          groupId: { in: groupIds },
          status: "approved",
          OR: [{ fromId: me }, { toId: me }],
        },
        select: { groupId: true, fromId: true, amount: true },
      }),
    ]);

    // net = paid − own share + cash paid out − cash received (matches computeBalances).
    for (const e of myPaid) net.set(e.groupId, (net.get(e.groupId) ?? 0) + e.amount);
    for (const s of myShares) {
      const gid = s.expense.groupId;
      net.set(gid, (net.get(gid) ?? 0) - s.amount);
    }
    for (const s of mySettlements) {
      const delta = s.fromId === me ? s.amount : -s.amount;
      net.set(s.groupId, (net.get(s.groupId) ?? 0) + delta);
    }
  }

  return memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    emoji: m.group.emoji,
    thumbnail: m.group.thumbnail,
    currency: m.group.currency,
    role: m.role as "owner" | "member",
    memberCount: m.group._count.members,
    net: round2(net.get(m.group.id) ?? 0),
  }));
}

// GET /api/groups — every group the current user belongs to, with their net.
groupsRouter.get(
  "/",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    return res.json({ groups: await listGroupsFor(r.session.userId) });
  })
);

// POST /api/groups — create a group; the creator becomes its owner. Optionally
// fires off invites to a batch of existing users in the same step.
groupsRouter.post(
  "/",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = groupCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, currency, emoji, thumbnail, inviteeIds } = parsed.data;
    const group = await prisma.group.create({
      data: {
        name,
        currency: currency || "INR",
        emoji: emoji || null,
        thumbnail: thumbnail || null,
        createdById: r.session.userId,
        members: { create: { userId: r.session.userId, role: "owner" } },
      },
      select: { id: true, name: true, emoji: true, thumbnail: true, currency: true },
    });

    // Send invites to any valid, distinct users (never the creator).
    let invited = 0;
    const uniqueIds = Array.from(new Set(inviteeIds ?? [])).filter(
      (id) => id && id !== r.session.userId
    );
    if (uniqueIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (users.length > 0) {
        // The group is brand new, so no pre-existing invites can collide.
        const result = await prisma.invite.createMany({
          data: users.map((u) => ({
            groupId: group.id,
            inviteeId: u.id,
            invitedById: r.session.userId,
          })),
        });
        invited = result.count;
      }
    }

    return res.status(201).json({
      group: { ...group, role: "owner", memberCount: 1, net: 0 },
      invited,
    });
  })
);

// Group detail with members + the caller's role. Shared by GET /groups/:id and
// the combined bootstrap endpoint. Returns null if the group vanished.
async function groupDetailFor(groupId: string, membershipRole: MemberRole | undefined, userId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      emoji: true,
      thumbnail: true,
      currency: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, avatar: true } },
      members: {
        select: { role: true, user: { select: { id: true, name: true, avatar: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!group) return null;
  return {
    id: group.id,
    name: group.name,
    emoji: group.emoji,
    thumbnail: group.thumbnail,
    currency: group.currency,
    createdAt: group.createdAt,
    createdBy: group.createdBy ? publicUser(group.createdBy) : null,
    role: membershipRole,
    myUserId: userId,
    members: group.members.map((m) => ({ ...publicUser(m.user), role: m.role })),
  };
}

// GET /api/groups/:groupId — detail with members + current user's role.
groupsRouter.get(
  "/:groupId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const group = await groupDetailFor(req.params.groupId, r.membershipRole, r.session.userId);
    if (!group) return res.status(404).json({ error: "Group not found" });
    return res.json({ group });
  })
);

// PATCH /api/groups/:groupId — owner edits name/emoji/thumbnail/currency.
groupsRouter.patch(
  "/:groupId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    if (!isElevated(r.membershipRole)) {
      return res.status(403).json({ error: "Only owners and moderators can edit this group." });
    }
    const parsed = groupPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const data = parsed.data;
    const group = await prisma.group.update({
      where: { id: req.params.groupId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.emoji !== undefined ? { emoji: data.emoji || null } : {}),
        ...(data.thumbnail !== undefined ? { thumbnail: data.thumbnail || null } : {}),
      },
      select: { id: true, name: true, emoji: true, thumbnail: true, currency: true },
    });
    return res.json({ group });
  })
);

// DELETE /api/groups/:groupId — owner deletes the whole group (cascades).
groupsRouter.delete(
  "/:groupId",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    if (r.membershipRole !== "owner") {
      return res.status(403).json({ error: "Only the group owner can delete it." });
    }
    await prisma.group.delete({ where: { id: req.params.groupId } });
    return res.json({ ok: true });
  })
);

// POST /api/groups/:groupId/leave — a member leaves (must be settled up first).
groupsRouter.post(
  "/:groupId/leave",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const { balances } = await loadBalances(req.params.groupId);
    const mine = balances.find((b) => b.id === r.session.userId);
    if (mine && Math.abs(mine.net) > 0.01) {
      return res.status(400).json({
        error: "Settle up your balance before leaving this group.",
      });
    }
    if (r.membershipRole === "owner") {
      return res.status(400).json({
        error: "Owners can't leave — delete the group or transfer it first.",
      });
    }
    await prisma.membership.delete({
      where: { groupId_userId: { groupId: req.params.groupId, userId: r.session.userId } },
    });
    return res.json({ ok: true });
  })
);

// GET /api/groups/:groupId/balances — net per member + simplified debts.
groupsRouter.get(
  "/:groupId/balances",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const { balances } = await loadBalances(req.params.groupId);
    const debts = simplifyDebts(balances);
    const mine = balances.find((b) => b.id === r.session.userId);
    return res.json({ balances, debts, myNet: mine?.net ?? 0 });
  })
);

// Compute a group's stats (basic for everyone; advanced only for elevated
// roles). Shared by GET /groups/:id/stats and the combined bootstrap endpoint.
// Returns null if the group vanished.
async function groupStatsFor(groupId: string, membershipRole: MemberRole | undefined, me: string) {
    const [group, members, expenses, settlements] = await prisma.$transaction([
      prisma.group.findUnique({ where: { id: groupId }, select: { createdAt: true } }),
      prisma.membership.findMany({
        where: { groupId },
        select: { user: { select: { id: true, name: true, avatar: true } } },
      }),
      prisma.expense.findMany({
        where: { groupId },
        select: {
          amount: true,
          category: true,
          date: true,
          paidById: true,
          createdAt: true,
          shares: { select: { userId: true, amount: true } },
        },
        orderBy: { date: "asc" },
      }),
      prisma.settlement.findMany({
        where: { groupId },
        select: { amount: true, status: true, createdAt: true },
      }),
    ]);
    if (!group) return null;

    const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
    const myPaid = expenses
      .filter((e) => e.paidById === me)
      .reduce((s, e) => s + e.amount, 0);
    const myShare = expenses.reduce(
      (s, e) => s + (e.shares.find((sh) => sh.userId === me)?.amount ?? 0),
      0
    );
    const approvedSettlements = settlements.filter((s) => s.status === "approved");
    const pendingSettlements = settlements.filter((s) => s.status === "pending").length;

    const lastExpense = expenses[expenses.length - 1]?.createdAt ?? null;
    const lastSettlement =
      settlements.length > 0
        ? settlements.reduce(
            (max, s) => (s.createdAt > max ? s.createdAt : max),
            settlements[0].createdAt
          )
        : null;
    const lastActivityAt =
      lastExpense && lastSettlement
        ? lastExpense > lastSettlement
          ? lastExpense
          : lastSettlement
        : lastExpense ?? lastSettlement;

    const basic = {
      createdAt: group.createdAt.toISOString(),
      memberCount: members.length,
      expenseCount: expenses.length,
      totalSpent,
      firstExpenseAt: expenses[0]?.date?.toISOString() ?? null,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      myPaid,
      myShare,
      settledCount: approvedSettlements.length,
      pendingSettlements,
    };

    let advanced = null;
    if (isElevated(membershipRole)) {
      const paidBy = new Map<string, number>();
      const shareBy = new Map<string, number>();
      const catTotals = new Map<string, number>();
      const activeDays = new Set<string>();
      let largest = 0;

      for (const e of expenses) {
        paidBy.set(e.paidById, (paidBy.get(e.paidById) ?? 0) + e.amount);
        catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.amount);
        activeDays.add(e.date.toISOString().slice(0, 10));
        if (e.amount > largest) largest = e.amount;
        for (const sh of e.shares) {
          shareBy.set(sh.userId, (shareBy.get(sh.userId) ?? 0) + sh.amount);
        }
      }

      const perMember = members
        .map((m) => ({
          id: m.user.id,
          name: m.user.name,
          avatar: m.user.avatar ?? null,
          paid: paidBy.get(m.user.id) ?? 0,
          share: shareBy.get(m.user.id) ?? 0,
          net: (paidBy.get(m.user.id) ?? 0) - (shareBy.get(m.user.id) ?? 0),
        }))
        .sort((a, b) => b.paid - a.paid);

      const topSpender = perMember[0] && perMember[0].paid > 0
        ? { id: perMember[0].id, name: perMember[0].name, amount: perMember[0].paid }
        : null;

      const categories = Array.from(catTotals.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

      advanced = {
        avgExpense: expenses.length ? totalSpent / expenses.length : 0,
        largestExpense: largest,
        activeDays: activeDays.size,
        settlementVolume: approvedSettlements.reduce((s, x) => s + x.amount, 0),
        topSpender,
        perMember,
        categories,
      };
    }

    return { basic, advanced };
}

// GET /api/groups/:groupId/stats — basic metrics for everyone; advanced metrics
// (per-member breakdown, top spender, categories…) only for owner/moderator.
groupsRouter.get(
  "/:groupId/stats",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const stats = await groupStatsFor(req.params.groupId, r.membershipRole, r.session.userId);
    if (!stats) return res.status(404).json({ error: "Group not found" });
    return res.json({ stats });
  })
);

// GET /api/groups/:groupId/bootstrap — EVERYTHING the group page needs in ONE
// round-trip: detail, expenses, balances/debts, settlements and stats. The page
// used to fire 5 separate requests; on a remote Postgres each is its own
// serverless invocation + connection acquisition, so collapsing them into a
// single call is the biggest win against cold-start latency. Queries run
// sequentially to stay friendly to a connection_limit=1 pool.
groupsRouter.get(
  "/:groupId/bootstrap",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const groupId = req.params.groupId;
    const me = r.session.userId;

    const group = await groupDetailFor(groupId, r.membershipRole, me);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const expenses = await listExpensesFor(groupId);
    const { balances } = await loadBalances(groupId);
    const debts = simplifyDebts(balances);
    const myNet = balances.find((b) => b.id === me)?.net ?? 0;
    const settlements = await listSettlementsFor(groupId, me);
    const stats = await groupStatsFor(groupId, r.membershipRole, me);

    return res.json({ group, expenses, balances, debts, myNet, settlements, stats });
  })
);

// POST /api/groups/:groupId/members/:userId/role — owner promotes/demotes a
// member to/from moderator. Owners can't be changed here.
groupsRouter.post(
  "/:groupId/members/:userId/role",
  requireAuth,
  requireMember(),
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    if (r.membershipRole !== "owner") {
      return res.status(403).json({ error: "Only the group owner can manage roles." });
    }
    const parsed = roleActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { groupId, userId } = req.params;
    if (userId === r.session.userId) {
      return res.status(400).json({ error: "You can't change your own role." });
    }

    const target = await prisma.membership.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true },
    });
    if (!target) return res.status(404).json({ error: "That person isn't in this group." });
    if (target.role === "owner") {
      return res.status(400).json({ error: "You can't change the owner's role." });
    }

    await prisma.membership.update({
      where: { groupId_userId: { groupId, userId } },
      data: { role: parsed.data.role },
    });
    return res.json({ ok: true, userId, role: parsed.data.role });
  })
);
