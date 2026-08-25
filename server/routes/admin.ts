import { Router, type RequestHandler } from "express";
import os from "node:os";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { adminActionSchema } from "../../shared/validation.js";
import { ah, zodMessage } from "../lib/http.js";

export const adminRouter = Router();

// The admin password. Prefer a dedicated ADMIN_SECRET; fall back to AUTH_SECRET
// so local dev works out of the box with the value already in .env.
function serverAdminSecret(): string | null {
  return process.env.ADMIN_SECRET || process.env.AUTH_SECRET || null;
}

// Length-independent, timing-safe comparison (hash both to a fixed size first).
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Gate every admin route behind the shared secret (header or body). Returns 500
// if the server isn't configured, 401 on mismatch.
const adminGate: RequestHandler = (req, res, next) => {
  const server = serverAdminSecret();
  if (!server) {
    res.status(500).json({ error: "Admin access isn't configured on the server." });
    return;
  }
  const provided =
    (req.headers["x-admin-secret"] as string | undefined) ||
    (typeof req.body?.secret === "string" ? req.body.secret : "");
  if (!provided || !secretsMatch(provided, server)) {
    res.status(401).json({ error: "Invalid admin secret." });
    return;
  }
  next();
};

adminRouter.use(adminGate);

type Questionnaire = Record<string, string>;
function parseQuestionnaire(raw: string): Questionnaire {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Questionnaire) : {};
  } catch {
    return {};
  }
}

// Midnight `n` days ago (local) — for growth windows and daily buckets.
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// Bucket rows ({ createdAt, amount? }) into the last `days` calendar days.
function dailySeries(
  rows: { createdAt: Date; amount?: number }[],
  days: number
): { date: string; count: number; total: number }[] {
  const buckets = new Map<string, { count: number; total: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgo(i);
    buckets.set(d.toISOString().slice(0, 10), { count: 0, total: 0 });
  }
  for (const r of rows) {
    const key = new Date(r.createdAt).toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (b) {
      b.count += 1;
      b.total += r.amount ?? 0;
    }
  }
  return [...buckets.entries()].map(([date, v]) => ({ date, count: v.count, total: v.total }));
}

// ── Storage & host metrics ────────────────────────────────────────────────

type Attachment = { count: number; bytes: number };
type StorageStats = {
  provider: "postgresql" | "sqlite";
  dbBytes: number | null;
  limitBytes: number | null;
  tables: { name: string; bytes: number }[];
  attachments: {
    avatars: Attachment;
    groupCovers: Attachment;
    receipts: Attachment;
    settlementProofs: Attachment;
    totalCount: number;
    totalBytes: number;
  };
};

// Real on-disk footprint of the database: total size, per-table sizes (Postgres),
// and how many bytes each kind of base64 image (avatars, group covers, receipts,
// settlement proofs) is taking. Best-effort — returns null if the DB rejects the
// introspection queries rather than breaking the whole dashboard.
// The generated client's real datasource provider ("postgresql" | "sqlite"),
// which is authoritative — locally the client connects to SQLite even though the
// .env DATABASE_URL points at production Postgres, so we must NOT infer from env.
function activeProvider(): string {
  return (prisma as unknown as { _activeProvider?: string })._activeProvider ?? "";
}

async function storageStats(): Promise<StorageStats | null> {
  const isPg = activeProvider() === "postgresql";
  const limitMb = Number(process.env.ADMIN_STORAGE_LIMIT_MB ?? "");
  const limitBytes = Number.isFinite(limitMb) && limitMb > 0 ? limitMb * 1024 * 1024 : null;

  try {
    if (isPg) {
      // octet_length gives true byte size of the stored text.
      const [att] = await prisma.$queryRawUnsafe<
        {
          avatar_bytes: number;
          avatar_count: number;
          cover_bytes: number;
          cover_count: number;
          receipt_bytes: number;
          receipt_count: number;
          proof_bytes: number;
          proof_count: number;
        }[]
      >(
        `SELECT
           COALESCE((SELECT SUM(octet_length(avatar)) FROM "User"),0)::float8       AS avatar_bytes,
           (SELECT COUNT(*) FROM "User" WHERE avatar IS NOT NULL)::int              AS avatar_count,
           COALESCE((SELECT SUM(octet_length(thumbnail)) FROM "Group"),0)::float8   AS cover_bytes,
           (SELECT COUNT(*) FROM "Group" WHERE thumbnail IS NOT NULL)::int          AS cover_count,
           COALESCE((SELECT SUM(octet_length(thumbnail)) FROM "Expense"),0)::float8 AS receipt_bytes,
           (SELECT COUNT(*) FROM "Expense" WHERE thumbnail IS NOT NULL)::int        AS receipt_count,
           COALESCE((SELECT SUM(octet_length(thumbnail)) FROM "Settlement"),0)::float8 AS proof_bytes,
           (SELECT COUNT(*) FROM "Settlement" WHERE thumbnail IS NOT NULL)::int     AS proof_count`
      );
      const [dbRow] = await prisma.$queryRawUnsafe<{ bytes: number }[]>(
        `SELECT pg_database_size(current_database())::float8 AS bytes`
      );
      const tables = await prisma.$queryRawUnsafe<{ name: string; bytes: number }[]>(
        `SELECT c.relname AS name, pg_total_relation_size(c.oid)::float8 AS bytes
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY bytes DESC`
      );
      return buildStorage("postgresql", Number(dbRow?.bytes ?? 0), limitBytes, tables, att);
    }

    // SQLite (local dev): length() ≈ byte size for ASCII base64; DB size via PRAGMA.
    const [att] = await prisma.$queryRawUnsafe<
      {
        avatar_bytes: number;
        avatar_count: number;
        cover_bytes: number;
        cover_count: number;
        receipt_bytes: number;
        receipt_count: number;
        proof_bytes: number;
        proof_count: number;
      }[]
    >(
      `SELECT
         COALESCE((SELECT SUM(length(avatar)) FROM "User"),0)       AS avatar_bytes,
         (SELECT COUNT(*) FROM "User" WHERE avatar IS NOT NULL)     AS avatar_count,
         COALESCE((SELECT SUM(length(thumbnail)) FROM "Group"),0)   AS cover_bytes,
         (SELECT COUNT(*) FROM "Group" WHERE thumbnail IS NOT NULL) AS cover_count,
         COALESCE((SELECT SUM(length(thumbnail)) FROM "Expense"),0) AS receipt_bytes,
         (SELECT COUNT(*) FROM "Expense" WHERE thumbnail IS NOT NULL) AS receipt_count,
         COALESCE((SELECT SUM(length(thumbnail)) FROM "Settlement"),0) AS proof_bytes,
         (SELECT COUNT(*) FROM "Settlement" WHERE thumbnail IS NOT NULL) AS proof_count`
    );
    let dbBytes: number | null = null;
    try {
      const [pc] = await prisma.$queryRawUnsafe<{ n: number }[]>(`PRAGMA page_count`);
      const [ps] = await prisma.$queryRawUnsafe<{ n: number }[]>(`PRAGMA page_size`);
      // PRAGMA rows come back keyed by the pragma name; read the first value.
      const pcVal = pc ? Number(Object.values(pc)[0]) : 0;
      const psVal = ps ? Number(Object.values(ps)[0]) : 0;
      dbBytes = pcVal > 0 && psVal > 0 ? pcVal * psVal : null;
    } catch {
      dbBytes = null;
    }
    return buildStorage("sqlite", dbBytes, limitBytes, [], att);
  } catch {
    return null;
  }
}

// Fold the raw attachment counts/bytes into the response shape.
function buildStorage(
  provider: "postgresql" | "sqlite",
  dbBytes: number | null,
  limitBytes: number | null,
  tables: { name: string; bytes: number }[],
  att: {
    avatar_bytes: number;
    avatar_count: number;
    cover_bytes: number;
    cover_count: number;
    receipt_bytes: number;
    receipt_count: number;
    proof_bytes: number;
    proof_count: number;
  }
): StorageStats {
  const avatars = { count: Number(att.avatar_count ?? 0), bytes: Number(att.avatar_bytes ?? 0) };
  const groupCovers = { count: Number(att.cover_count ?? 0), bytes: Number(att.cover_bytes ?? 0) };
  const receipts = { count: Number(att.receipt_count ?? 0), bytes: Number(att.receipt_bytes ?? 0) };
  const settlementProofs = { count: Number(att.proof_count ?? 0), bytes: Number(att.proof_bytes ?? 0) };
  return {
    provider,
    dbBytes,
    limitBytes,
    tables: tables.map((t) => ({ name: String(t.name), bytes: Number(t.bytes ?? 0) })),
    attachments: {
      avatars,
      groupCovers,
      receipts,
      settlementProofs,
      totalCount: avatars.count + groupCovers.count + receipts.count + settlementProofs.count,
      totalBytes: avatars.bytes + groupCovers.bytes + receipts.bytes + settlementProofs.bytes,
    },
  };
}

// Free space of the writable filesystem (os.tmpdir()). On serverless the root
// image is read-only and always reports ~full, so we probe the temp dir — the
// only place the app can write — which is the headroom that actually matters.
async function diskStats(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  try {
    const fs = (await import("node:fs/promises")) as unknown as {
      statfs?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
    };
    if (!fs.statfs) return null;
    const s = await fs.statfs(os.tmpdir());
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    if (!(totalBytes > 0)) return null;
    return { usedBytes: Math.max(0, totalBytes - freeBytes), totalBytes };
  } catch {
    return null;
  }
}

// GET /api/admin/metrics — a rich, Spendly-Plus-style dashboard: platform totals,
// growth windows, a 14-day trend, top categories / groups / spenders, currency &
// split-mode mix, engagement, recovery breakdown, storage footprint, and live
// host stats.
adminRouter.get(
  "/metrics",
  ah(async (_req, res) => {
    const d7 = daysAgo(7);
    const d30 = daysAgo(30);
    const d14 = daysAgo(13); // inclusive of today → 14 buckets

    // Run every read in ONE sequential batch transaction. Firing these as a
    // parallel Promise.all would need many DB connections at once, which blows
    // the pool (SQLite = 1; the pooled Postgres URL uses connection_limit=1),
    // causing P2024 "timed out fetching a connection". $transaction reuses a
    // single connection and runs them in order.
    const [
      users,
      groups,
      expenses,
      memberships,
      settlements,
      expenseAgg,
      settledAgg,
      settledCount,
      invitesPending,
      usersWithAvatar,
      reminderOn,
      groupsWithThumb,
      expensesWithReceipt,
      newUsers7,
      newUsers30,
      newGroups7,
      newGroups30,
      newExpenses7,
      newExpenses30,
      catRows,
      splitRows,
      currencyRows,
      groupSpendRows,
      payerRows,
      resetStatusRows,
      recentExpenses,
      recentUsers,
      topGroupSize,
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.group.count(),
      prisma.expense.count(),
      prisma.membership.count(),
      prisma.settlement.count(),
      prisma.expense.aggregate({ _sum: { amount: true }, _avg: { amount: true } }),
      prisma.settlement.aggregate({ _sum: { amount: true }, where: { status: "approved" } }),
      prisma.settlement.count({ where: { status: "approved" } }),
      prisma.invite.count({ where: { status: "pending" } }),
      prisma.user.count({ where: { NOT: { avatar: null } } }),
      prisma.user.count({ where: { reminderEnabled: true } }),
      prisma.group.count({ where: { NOT: { thumbnail: null } } }),
      prisma.expense.count({ where: { NOT: { thumbnail: null } } }),
      prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      prisma.group.count({ where: { createdAt: { gte: d7 } } }),
      prisma.group.count({ where: { createdAt: { gte: d30 } } }),
      prisma.expense.count({ where: { createdAt: { gte: d7 } } }),
      prisma.expense.count({ where: { createdAt: { gte: d30 } } }),
      prisma.expense.groupBy({
        by: ["category"],
        _count: { _all: true },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 8,
      }),
      prisma.expense.groupBy({ by: ["splitMode"], _count: { _all: true } }),
      prisma.group.groupBy({ by: ["currency"], _count: { _all: true } }),
      prisma.expense.groupBy({
        by: ["groupId"],
        _count: { _all: true },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 6,
      }),
      prisma.expense.groupBy({
        by: ["paidById"],
        _count: { _all: true },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 6,
      }),
      prisma.resetRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.expense.findMany({
        where: { createdAt: { gte: d14 } },
        select: { createdAt: true, amount: true },
      }),
      prisma.user.findMany({
        where: { createdAt: { gte: d14 } },
        select: { createdAt: true },
      }),
      prisma.membership.groupBy({
        by: ["groupId"],
        _count: { _all: true },
        orderBy: { _count: { groupId: "desc" } },
        take: 1,
      }),
    ]);

    // Resolve names for top groups / payers.
    const gIds = groupSpendRows.map((r) => r.groupId);
    const pIds = payerRows.map((r) => r.paidById);
    const [gMeta, pMeta] = await prisma.$transaction([
      prisma.group.findMany({
        where: { id: { in: gIds } },
        select: { id: true, name: true, emoji: true, currency: true },
      }),
      prisma.user.findMany({ where: { id: { in: pIds } }, select: { id: true, name: true } }),
    ]);
    const gName = new Map(gMeta.map((g) => [g.id, g]));
    const pName = new Map(pMeta.map((u) => [u.id, u.name]));

    const resetByStatus = { pending: 0, approved: 0, rejected: 0 } as Record<string, number>;
    for (const r of resetStatusRows) resetByStatus[r.status] = r._count._all;

    const grandTotal = expenseAgg._sum.amount ?? 0;

    // Storage footprint + writable-disk headroom (both best-effort).
    const [storage, disk] = [await storageStats(), await diskStats()];

    // Host runtime stats (best-effort; loadavg is 0 on serverless).
    const cores = (os.cpus() ?? []).length || 1;
    const load1 = os.loadavg?.()[0] ?? 0;

    // On Vercel/Lambda the meaningful memory ceiling is the function's configured
    // size, so measure process RSS against it. Elsewhere fall back to host RAM.
    const rss = process.memoryUsage().rss;
    const lambdaMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? "");
    const useProcessMem = Number.isFinite(lambdaMb) && lambdaMb > 0;
    const memTotal = useProcessMem ? lambdaMb * 1024 * 1024 : os.totalmem();
    const usedMem = useProcessMem ? rss : Math.max(0, memTotal - os.freemem());

    return res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        users,
        groups,
        expenses,
        memberships,
        settlements,
        settledCount,
        grandTotal,
        settledTotal: settledAgg._sum.amount ?? 0,
        avgExpense: expenseAgg._avg.amount ?? 0,
        avgMembersPerGroup: groups ? memberships / groups : 0,
        avgExpensesPerGroup: groups ? expenses / groups : 0,
        avgGroupsPerUser: users ? memberships / users : 0,
        invitesPending,
        biggestGroupSize: topGroupSize[0]?._count._all ?? 0,
      },
      growth: {
        users: { d7: newUsers7, d30: newUsers30 },
        groups: { d7: newGroups7, d30: newGroups30 },
        expenses: { d7: newExpenses7, d30: newExpenses30 },
      },
      series: {
        expenses: dailySeries(recentExpenses, 14),
        signups: dailySeries(recentUsers, 14),
      },
      categories: catRows.map((r) => ({
        category: r.category,
        count: r._count._all,
        total: r._sum.amount ?? 0,
      })),
      splitModes: splitRows.map((r) => ({ mode: r.splitMode, count: r._count._all })),
      currencies: currencyRows
        .map((r) => ({ currency: r.currency, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      topGroups: groupSpendRows.map((r) => ({
        id: r.groupId,
        name: gName.get(r.groupId)?.name ?? "—",
        emoji: gName.get(r.groupId)?.emoji ?? null,
        currency: gName.get(r.groupId)?.currency ?? "INR",
        count: r._count._all,
        total: r._sum.amount ?? 0,
      })),
      topPayers: payerRows.map((r) => ({
        id: r.paidById,
        name: pName.get(r.paidById) ?? "—",
        count: r._count._all,
        total: r._sum.amount ?? 0,
      })),
      engagement: {
        usersWithAvatar,
        reminderOn,
        groupsWithThumb,
        expensesWithReceipt,
      },
      recovery: {
        pending: resetByStatus.pending ?? 0,
        approved: resetByStatus.approved ?? 0,
        rejected: resetByStatus.rejected ?? 0,
      },
      storage,
      system: {
        node: process.version,
        platform: `${os.type()} ${os.release()}`,
        uptimeSec: Math.round(process.uptime()),
        cpuCores: cores,
        loadPct: load1 > 0 ? Math.min(100, (load1 / cores) * 100) : null,
        memBasis: useProcessMem ? "process" : "host",
        memUsedBytes: usedMem,
        memTotalBytes: memTotal,
        rssBytes: rss,
        diskUsedBytes: disk?.usedBytes ?? null,
        diskTotalBytes: disk?.totalBytes ?? null,
        dbProvider: activeProvider() || "unknown",
        region: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? null,
      },
    });
  })
);

// GET /api/admin/reset-requests — list requests (pending first) with the answers
// to verify plus the account's real data, so an admin can decide at a glance.
adminRouter.get(
  "/reset-requests",
  ah(async (_req, res) => {
    const rows = await prisma.resetRequest.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        status: true,
        questionnaire: true,
        createdAt: true,
        resolvedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            memberships: {
              select: {
                group: {
                  select: {
                    name: true,
                    members: { select: { user: { select: { id: true, name: true } } } },
                    expenses: { select: { title: true, amount: true }, take: 20 },
                  },
                },
              },
            },
          },
        },
      },
    });

    const requests = rows.map((r) => {
      const groups: string[] = [];
      const members = new Set<string>();
      const expenses: { title: string; amount: number }[] = [];
      for (const m of r.user.memberships) {
        groups.push(m.group.name);
        for (const gm of m.group.members) {
          if (gm.user.id !== r.user.id) members.add(gm.user.name);
        }
        for (const e of m.group.expenses) expenses.push({ title: e.title, amount: e.amount });
      }
      return {
        id: r.id,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        answers: parseQuestionnaire(r.questionnaire),
        user: {
          name: r.user.name,
          memberSince: r.user.createdAt.toISOString(),
        },
        // The "truth" an admin checks the answers against.
        truth: { groups, members: [...members], expenses: expenses.slice(0, 12) },
      };
    });

    return res.json({ requests });
  })
);

// POST /api/admin/reset-requests/:id — approve (apply the proposed passphrase) or
// reject a request.
adminRouter.post(
  "/reset-requests/:id",
  ah(async (req, res) => {
    const parsed = adminActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const rr = await prisma.resetRequest.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, userId: true, proposedHash: true },
    });
    if (!rr) return res.status(404).json({ error: "Request not found." });
    if (rr.status !== "pending") {
      return res.status(409).json({ error: `Already ${rr.status}.` });
    }

    if (parsed.data.action === "approve") {
      // Apply the passphrase the user proposed at request time.
      await prisma.user.update({
        where: { id: rr.userId },
        data: { passHash: rr.proposedHash },
      });
    }

    const status = parsed.data.action === "approve" ? "approved" : "rejected";
    await prisma.resetRequest.update({
      where: { id: rr.id },
      data: { status, resolvedAt: new Date() },
    });

    return res.json({ ok: true, status });
  })
);
