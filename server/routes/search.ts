import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ah, requireAuth, type AuthedRequest } from "../lib/http.js";

// Mounted at /api.
export const searchRouter = Router();

// Postgres supports case-insensitive `contains` via `mode`; SQLite doesn't accept
// the `mode` key at all (its LIKE is already case-insensitive for ASCII). Detect
// the real datasource from the generated client, not the env, since local dev
// runs SQLite even when DATABASE_URL points at production Postgres.
function activeProvider(): string {
  return (prisma as unknown as { _activeProvider?: string })._activeProvider ?? "";
}
function contains(q: string) {
  return activeProvider() === "postgresql"
    ? { contains: q, mode: "insensitive" as const }
    : { contains: q };
}

// GET /api/search?q=... — casual, cross-group expense search scoped to the groups
// the current user belongs to. Matches title / category / notes and returns which
// group each result lives in so the client can deep-link straight to it.
searchRouter.get(
  "/search",
  requireAuth,
  ah(async (req, res) => {
    const me = (req as AuthedRequest).session.userId;
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) return res.json({ results: [] });

    const memberships = await prisma.membership.findMany({
      where: { userId: me },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return res.json({ results: [] });

    const rows = await prisma.expense.findMany({
      where: {
        groupId: { in: groupIds },
        OR: [{ title: contains(q) }, { category: contains(q) }, { notes: contains(q) }],
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        groupId: true,
        title: true,
        category: true,
        amount: true,
        date: true,
        paidBy: { select: { id: true, name: true, avatar: true } },
        group: { select: { id: true, name: true, emoji: true, currency: true } },
      },
    });

    const results = rows.map((e) => ({
      id: e.id,
      groupId: e.groupId,
      title: e.title,
      category: e.category,
      amount: e.amount,
      date: e.date.toISOString(),
      paidBy: { id: e.paidBy.id, name: e.paidBy.name, avatar: e.paidBy.avatar ?? null },
      group: {
        id: e.group.id,
        name: e.group.name,
        emoji: e.group.emoji ?? null,
        currency: e.group.currency,
      },
    }));

    return res.json({ results });
  })
);

// GET /api/export/expenses — every expense across ALL of the current user's
// groups, flattened with group + payer + per-member shares. Powers the
// "overall" PDF/Excel export. Data is returned unfiltered; the client narrows
// it down by month / year before generating the document.
searchRouter.get(
  "/export/expenses",
  requireAuth,
  ah(async (req, res) => {
    const me = (req as AuthedRequest).session.userId;

    const memberships = await prisma.membership.findMany({
      where: { userId: me },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return res.json({ expenses: [] });

    const rows = await prisma.expense.findMany({
      where: { groupId: { in: groupIds } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        groupId: true,
        title: true,
        category: true,
        amount: true,
        date: true,
        notes: true,
        splitMode: true,
        paidBy: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, emoji: true, currency: true } },
        shares: { select: { userId: true, amount: true, user: { select: { name: true } } } },
      },
    });

    const expenses = rows.map((e) => ({
      id: e.id,
      groupId: e.groupId,
      title: e.title,
      category: e.category,
      amount: e.amount,
      date: e.date.toISOString(),
      notes: e.notes ?? null,
      splitMode: e.splitMode,
      paidBy: { id: e.paidBy.id, name: e.paidBy.name },
      myShare: e.shares.find((s) => s.userId === me)?.amount ?? 0,
      group: {
        id: e.group.id,
        name: e.group.name,
        emoji: e.group.emoji ?? null,
        currency: e.group.currency,
      },
    }));

    return res.json({ expenses });
  })
);
