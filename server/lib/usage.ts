import type { RequestHandler } from "express";
import { waitUntil } from "@vercel/functions";
import { prisma } from "./prisma.js";

// ── API request counter ───────────────────────────────────────────────────
//
// Requests are tallied in memory per UTC hour and written to ApiUsage in one
// upsert per hour bucket. A flush only runs when the database has been queried
// in the last minute (so it's already awake and the write costs no extra
// compute time) and at most once a minute. Requests that never touch the DB,
// like /health, can therefore never wake Neon through this counter.

const FLUSH_EVERY_MS = 60_000;
const DB_AWAKE_MS = 60_000;
const SKIP = /^\/api\/(health|version)(\/|\?|$)|^\/api\/ntfy\/banner\//;

const pending = new Map<number, number>();
let lastDbAt = 0;
let lastFlushAt = 0;
let flushing = false;
let disabledUntil = 0;

prisma.$use(async (params, next) => {
  lastDbAt = Date.now();
  return next(params);
});

function hourStart(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

async function flush(): Promise<void> {
  if (flushing || !pending.size) return;
  flushing = true;
  lastFlushAt = Date.now();
  const batch = [...pending.entries()];
  pending.clear();
  try {
    for (const [hour, n] of batch) {
      const at = new Date(hour);
      await prisma.apiUsage.upsert({
        where: { hour: at },
        create: { hour: at, requests: n },
        update: { requests: { increment: n } },
      });
    }
  } catch (e) {
    for (const [hour, n] of batch) pending.set(hour, (pending.get(hour) ?? 0) + n);
    // Table missing (schema not pushed yet) or DB unreachable: back off.
    disabledUntil = Date.now() + 10 * 60_000;
    if ((e as { code?: string }).code !== "P2021") console.error("[usage] flush failed", e);
  } finally {
    flushing = false;
  }
}

export const countRequests: RequestHandler = (req, res, next) => {
  if (req.method === "OPTIONS" || SKIP.test(req.originalUrl)) return next();
  const hour = hourStart(Date.now());
  pending.set(hour, (pending.get(hour) ?? 0) + 1);
  res.on("finish", () => {
    const now = Date.now();
    if (now < disabledUntil || now - lastFlushAt < FLUSH_EVERY_MS || now - lastDbAt > DB_AWAKE_MS) return;
    waitUntil(flush());
  });
  next();
};

export type RequestStats = {
  last24h: number;
  last7d: number;
  periodTotal: number;
  hourly: { hour: string; count: number }[];
  daily: { date: string; count: number }[];
};

// Reads ApiUsage (wakes the DB). `since` is the start of the Neon billing period.
export async function requestStats(since: Date): Promise<RequestStats | null> {
  try {
    const now = Date.now();
    const from = new Date(Math.min(since.getTime(), hourStart(now) - 13 * 86_400_000));
    const rows = await prisma.apiUsage.findMany({ where: { hour: { gte: from } }, orderBy: { hour: "asc" } });
    // Include requests counted on this instance but not flushed yet.
    const all = rows.map((r) => ({ t: r.hour.getTime(), n: r.requests }));
    for (const [t, n] of pending) all.push({ t, n });

    const hourly = new Map<number, number>();
    for (let i = 23; i >= 0; i--) hourly.set(hourStart(now) - i * 3_600_000, 0);
    const daily = new Map<string, number>();
    for (let i = 13; i >= 0; i--) daily.set(new Date(now - i * 86_400_000).toISOString().slice(0, 10), 0);

    let last24h = 0, last7d = 0, periodTotal = 0;
    for (const { t, n } of all) {
      if (t >= since.getTime()) periodTotal += n;
      if (t > now - 7 * 86_400_000) last7d += n;
      if (t > now - 86_400_000) last24h += n;
      if (hourly.has(t)) hourly.set(t, hourly.get(t)! + n);
      const day = new Date(t).toISOString().slice(0, 10);
      if (daily.has(day)) daily.set(day, daily.get(day)! + n);
    }

    // Keep the table small: drop buckets older than ~3 months.
    await prisma.apiUsage.deleteMany({ where: { hour: { lt: new Date(now - 95 * 86_400_000) } } });

    return {
      last24h,
      last7d,
      periodTotal,
      hourly: [...hourly].map(([t, count]) => ({ hour: new Date(t).toISOString(), count })),
      daily: [...daily].map(([date, count]) => ({ date, count })),
    };
  } catch {
    return null;
  }
}

// ── Neon compute usage (Neon API — never wakes the database) ──────────────

export type NeonUsage = {
  configured: boolean;
  error?: string;
  periodStart?: string;
  periodEnd?: string;
  cuHours?: number;
  activeHours?: number;
  limitCuHours: number;
  projectedCuHours?: number | null;
  dataTransferBytes?: number;
  compute?: {
    state: string;
    lastActive: string | null;
    minCu: number;
    maxCu: number;
    suspendSeconds: number;
  } | null;
};

const NEON_API = "https://console.neon.tech/api/v2";
let neonCache: { at: number; value: NeonUsage } | null = null;

async function neonGet<T>(path: string, key: string): Promise<T> {
  const r = await fetch(`${NEON_API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(r.status === 401 ? "Neon API key was rejected" : `Neon API returned ${r.status}`);
  return (await r.json()) as T;
}

export async function neonUsage(): Promise<NeonUsage> {
  const limitCuHours = Number(process.env.NEON_CU_HOURS_LIMIT) > 0 ? Number(process.env.NEON_CU_HOURS_LIMIT) : 100;
  const key = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!key || !projectId) return { configured: false, limitCuHours };
  if (neonCache && Date.now() - neonCache.at < 60_000) return neonCache.value;

  const id = encodeURIComponent(projectId);
  try {
    const [{ project: p }, { endpoints }] = await Promise.all([
      neonGet<{
        project: {
          compute_time_seconds?: number;
          active_time_seconds?: number;
          data_transfer_bytes?: number;
          consumption_period_start?: string;
          consumption_period_end?: string;
        };
      }>(`/projects/${id}`, key),
      neonGet<{
        endpoints: {
          type: string;
          current_state: string;
          last_active?: string;
          autoscaling_limit_min_cu: number;
          autoscaling_limit_max_cu: number;
          suspend_timeout_seconds: number;
        }[];
      }>(`/projects/${id}/endpoints`, key),
    ]);

    const cuHours = (p.compute_time_seconds ?? 0) / 3600;
    const start = p.consumption_period_start ? new Date(p.consumption_period_start) : null;
    let end = p.consumption_period_end ? new Date(p.consumption_period_end) : null;
    if (start && (!end || end.getTime() <= start.getTime() || end.getFullYear() < 2000)) {
      end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
    }
    let projectedCuHours: number | null = null;
    if (start && end) {
      const elapsed = (Date.now() - start.getTime()) / (end.getTime() - start.getTime());
      if (elapsed > 0.02) projectedCuHours = cuHours / Math.min(1, elapsed);
    }
    const rw = endpoints.find((e) => e.type === "read_write") ?? endpoints[0];

    const value: NeonUsage = {
      configured: true,
      periodStart: start?.toISOString(),
      periodEnd: end?.toISOString(),
      cuHours,
      activeHours: (p.active_time_seconds ?? 0) / 3600,
      limitCuHours,
      projectedCuHours,
      dataTransferBytes: p.data_transfer_bytes ?? 0,
      compute: rw
        ? {
            state: rw.current_state,
            lastActive: rw.last_active ?? null,
            minCu: rw.autoscaling_limit_min_cu,
            maxCu: rw.autoscaling_limit_max_cu,
            suspendSeconds: rw.suspend_timeout_seconds,
          }
        : null,
    };
    neonCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    return { configured: true, limitCuHours, error: e instanceof Error ? e.message : "Neon API request failed" };
  }
}
