import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  BarChart3,
  Check,
  Cpu,
  HardDrive,
  LifeBuoy,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Button, Card, EmptyState, Field, PasswordInput } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { api, ApiError, type AdminMetrics, type AdminResetRequest } from "@/lib/api";
import { useToast } from "@/state/toast";

const SECRET_KEY = "splitplus_admin_secret";

// ── formatters ──────────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(n));
const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtDec = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatusPill({ status }: { status: AdminResetRequest["status"] }) {
  const map = {
    pending: "bg-amber-500/15 text-amber-300",
    approved: "bg-emerald-500/15 text-emerald-300",
    rejected: "bg-rose-500/15 text-rose-300",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${map[status]}`}>
      {status}
    </span>
  );
}

function AnswerRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="w-24 shrink-0 text-white/40">{label}</span>
      <span className="text-white/85">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────────────
function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-white/40">{label}</div>
      <div className={`mt-1 text-2xl font-black ${accent ?? "text-white"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/45">{sub}</div>}
    </Card>
  );
}

// Horizontal bar list — used for categories, currencies, split modes.
function BarList({
  items,
  color = "#ffab33",
}: {
  items: { label: string; value: number; hint?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2.5">
      {items.length === 0 && <div className="text-sm text-white/40">No data yet.</div>}
      {items.map((it) => (
        <div key={it.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-white/80">{it.label}</span>
            <span className="shrink-0 font-semibold text-white/90">
              {fmtNum(it.value)}
              {it.hint && <span className="ml-1 text-xs font-normal text-white/40">{it.hint}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{ width: `${(it.value / max) * 100}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Meter({ label, used, total, sub }: { label: string; used: number; total: number; sub?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="font-semibold text-white/90">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: pct > 85 ? "#f43f5e" : "#ffab33" }}
        />
      </div>
      {sub && <div className="mt-1 text-xs text-white/40">{sub}</div>}
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-white/45">
      {icon}
      {children}
    </div>
  );
}

// ── metrics dashboard ────────────────────────────────────────────────────
function MetricsView({ m }: { m: AdminMetrics }) {
  const t = m.totals;
  const growthCard = (
    label: string,
    g: { d7: number; d30: number }
  ) => <Stat key={label} label={label} value={`+${g.d7}`} sub={`+${g.d30} in 30d`} accent="text-emerald-400" />;

  return (
    <div className="space-y-6">
      {/* Headline totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Users" value={fmtNum(t.users)} sub={`${fmtDec(t.avgGroupsPerUser)} groups/user`} />
        <Stat label="Groups" value={fmtNum(t.groups)} sub={`${fmtDec(t.avgMembersPerGroup)} members avg`} />
        <Stat label="Expenses" value={fmtNum(t.expenses)} sub={`${fmtDec(t.avgExpensesPerGroup)}/group`} />
        <Stat label="Total logged" value={fmtMoney(t.grandTotal)} sub="mixed currencies" accent="text-orange-300" />
        <Stat label="Avg expense" value={fmtMoney(t.avgExpense)} sub="per entry" />
        <Stat
          label="Settlements"
          value={fmtNum(t.settlements)}
          sub={`${fmtNum(t.settledCount)} confirmed`}
        />
        <Stat label="Confirmed paid" value={fmtMoney(t.settledTotal)} sub="approved settlements" accent="text-emerald-400" />
        <Stat label="Biggest group" value={`${fmtNum(t.biggestGroupSize)}`} sub="members" />
      </div>

      {/* Growth */}
      <div>
        <SectionTitle icon={<TrendingUp className="h-4 w-4" />}>Growth (last 7 days)</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {growthCard("New users", m.growth.users)}
          {growthCard("New groups", m.growth.groups)}
          {growthCard("New expenses", m.growth.expenses)}
        </div>
      </div>

      {/* Trend chart */}
      <Card className="p-4">
        <SectionTitle icon={<BarChart3 className="h-4 w-4" />}>Expenses — last 14 days</SectionTitle>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.series.expenses} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
              <defs>
                <linearGradient id="adminTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffab33" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#ffab33" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                tickFormatter={(d: string) => d.slice(5)}
                axisLine={false}
                tickLine={false}
                minTickGap={16}
              />
              <Tooltip
                contentStyle={{
                  background: "#1c1710",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 12,
                  color: "#fff",
                }}
                labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                formatter={(v: number, n: string) => [fmtNum(v), n === "count" ? "expenses" : "amount"]}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#ffab33"
                strokeWidth={2}
                fill="url(#adminTrend)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Top lists */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle icon={<BarChart3 className="h-4 w-4" />}>Top categories</SectionTitle>
          <BarList
            items={m.categories.map((c) => ({
              label: c.category,
              value: c.total,
              hint: `· ${c.count}`,
            }))}
          />
        </Card>
        <Card className="p-4">
          <SectionTitle icon={<Users className="h-4 w-4" />}>Top spenders</SectionTitle>
          <div className="space-y-2">
            {m.topPayers.length === 0 && <div className="text-sm text-white/40">No data yet.</div>}
            {m.topPayers.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
                <span className="w-5 text-center text-sm font-bold text-white/40">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/85">{p.name}</span>
                <span className="text-xs text-white/40">{p.count} exp</span>
                <span className="text-sm font-bold text-orange-300">{fmtMoney(p.total)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle icon={<BarChart3 className="h-4 w-4" />}>Top groups by spend</SectionTitle>
          <div className="space-y-2">
            {m.topGroups.length === 0 && <div className="text-sm text-white/40">No data yet.</div>}
            {m.topGroups.map((g, i) => (
              <div key={g.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
                <span className="w-5 text-center text-sm font-bold text-white/40">{i + 1}</span>
                <span className="text-lg">{g.emoji ?? "👥"}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/85">{g.name}</span>
                <span className="text-xs text-white/40">{g.count} exp</span>
                <span className="text-sm font-bold text-orange-300">
                  {g.currency} {fmtMoney(g.total)}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-4">
          <Card className="p-4">
            <SectionTitle icon={<BarChart3 className="h-4 w-4" />}>Currencies</SectionTitle>
            <BarList
              color="#10b981"
              items={m.currencies.map((c) => ({ label: c.currency, value: c.count, hint: "groups" }))}
            />
          </Card>
          <Card className="p-4">
            <SectionTitle icon={<BarChart3 className="h-4 w-4" />}>Split modes</SectionTitle>
            <BarList
              color="#a78bfa"
              items={m.splitModes.map((s) => ({ label: s.mode, value: s.count }))}
            />
          </Card>
        </div>
      </div>

      {/* Engagement + recovery */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Avatars set" value={fmtNum(m.engagement.usersWithAvatar)} sub={`of ${fmtNum(t.users)} users`} />
        <Stat label="Reminders on" value={fmtNum(m.engagement.reminderOn)} />
        <Stat label="Group covers" value={fmtNum(m.engagement.groupsWithThumb)} />
        <Stat label="Receipts" value={fmtNum(m.engagement.expensesWithReceipt)} sub="expenses w/ image" />
      </div>

      <Card className="p-4">
        <SectionTitle icon={<LifeBuoy className="h-4 w-4" />}>Recovery requests</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Pending" value={fmtNum(m.recovery.pending)} accent="text-amber-300" />
          <Stat label="Approved" value={fmtNum(m.recovery.approved)} accent="text-emerald-400" />
          <Stat label="Rejected" value={fmtNum(m.recovery.rejected)} accent="text-rose-300" />
        </div>
      </Card>

      {/* System */}
      <Card className="p-4">
        <SectionTitle icon={<Cpu className="h-4 w-4" />}>Host & runtime</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <Meter
              label="Memory (host)"
              used={m.system.memUsedBytes}
              total={m.system.memTotalBytes}
              sub={`RSS ${fmtBytes(m.system.rssBytes)} · ${fmtBytes(m.system.memUsedBytes)} / ${fmtBytes(m.system.memTotalBytes)}`}
            />
            {m.system.loadPct !== null && (
              <Meter label={`CPU load (${m.system.cpuCores} cores)`} used={m.system.loadPct} total={100} />
            )}
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-white/40">Node</span>
              <span className="text-white/85">{m.system.node}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Platform</span>
              <span className="truncate pl-3 text-white/85">{m.system.platform}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Uptime</span>
              <span className="text-white/85">{fmtUptime(m.system.uptimeSec)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40 flex items-center gap-1">
                <HardDrive className="h-3.5 w-3.5" /> Database
              </span>
              <span className="text-white/85">{m.system.dbProvider}</span>
            </div>
            {m.system.region && (
              <div className="flex justify-between">
                <span className="text-white/40">Region</span>
                <span className="text-white/85">{m.system.region}</span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <p className="pb-2 text-center text-xs text-white/25">
        Snapshot generated {new Date(m.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────
export function AdminPage() {
  const { success, error } = useToast();
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<"overview" | "requests">("overview");
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [requests, setRequests] = useState<AdminResetRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (s: string) => {
      setLoading(true);
      try {
        const [m, r] = await Promise.all([api.adminMetrics(s), api.adminListResets(s)]);
        setMetrics(m);
        setRequests(r.requests);
        setAuthed(true);
        try {
          sessionStorage.setItem(SECRET_KEY, s);
        } catch {
          /* ignore */
        }
      } catch (err) {
        setAuthed(false);
        error(err instanceof ApiError ? err.message : "Couldn't load the dashboard");
      } finally {
        setLoading(false);
      }
    },
    [error]
  );

  useEffect(() => {
    const saved = (() => {
      try {
        return sessionStorage.getItem(SECRET_KEY);
      } catch {
        return null;
      }
    })();
    if (saved) {
      setSecret(saved);
      load(saved);
    }
  }, [load]);

  async function resolve(req: AdminResetRequest, action: "approve" | "reject") {
    setBusyId(req.id);
    try {
      await api.adminResolveReset(secret, req.id, action);
      success(action === "approve" ? `Approved reset for ${req.user.name}` : "Request rejected");
      await load(secret);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't update request");
    } finally {
      setBusyId(null);
    }
  }

  const pending = requests.filter((r) => r.status === "pending");
  const resolved = requests.filter((r) => r.status !== "pending");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0807]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <LogoMark size={28} />
            <span className="text-lg font-bold text-white">Split+ Admin</span>
          </div>
          <div className="flex items-center gap-2">
            {authed && (
              <button
                onClick={() => load(secret)}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/10"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            )}
            <Link
              to="/"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/10"
            >
              Exit
            </Link>
          </div>
        </div>
        {authed && (
          <div className="mx-auto flex max-w-5xl gap-1 px-4 pb-2">
            {(["overview", "requests"] as const).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${
                  tab === tb ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                }`}
              >
                {tb === "requests" ? `Recovery${pending.length ? ` (${pending.length})` : ""}` : "Overview"}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {!authed ? (
          <div className="mx-auto max-w-sm pt-10">
            <Card className="p-6">
              <div className="mb-4 flex flex-col items-center text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-300">
                  <ShieldCheck className="h-6 w-6" />
                </span>
                <h1 className="mt-3 text-xl font-bold text-white">Admin access</h1>
                <p className="mt-1 text-sm text-white/50">
                  Enter the admin secret to view platform metrics and recovery requests.
                </p>
              </div>
              <Field label="Admin secret">
                <PasswordInput
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••••••"
                  onKeyDown={(e) => e.key === "Enter" && secret && load(secret)}
                />
              </Field>
              <Button
                className="mt-4 w-full justify-center"
                loading={loading}
                disabled={!secret}
                onClick={() => load(secret)}
              >
                Unlock
              </Button>
            </Card>
          </div>
        ) : tab === "overview" ? (
          metrics ? (
            <MetricsView m={metrics} />
          ) : (
            <div className="pt-10 text-center text-white/40">Loading metrics…</div>
          )
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
                Pending requests {pending.length > 0 && `(${pending.length})`}
              </h2>
              {pending.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<ShieldCheck className="h-8 w-8" />}
                    title="All clear"
                    subtitle="No recovery requests are waiting for approval."
                  />
                </Card>
              ) : (
                <div className="space-y-3">
                  {pending.map((r) => (
                    <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                      <Card className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-bold text-white">{r.user.name}</div>
                            <div className="text-xs text-white/40">
                              Requested {new Date(r.createdAt).toLocaleString()} · member since{" "}
                              {new Date(r.user.memberSince).toLocaleDateString(undefined, {
                                month: "short",
                                year: "numeric",
                              })}
                            </div>
                          </div>
                          <StatusPill status={r.status} />
                        </div>

                        <div className="mt-3 grid gap-4 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                              Their answers
                            </div>
                            <div className="space-y-1.5">
                              <AnswerRow label="Group" value={r.answers.groupName} />
                              <AnswerRow label="Expense" value={r.answers.expenseTitle} />
                              <AnswerRow label="Amount" value={r.answers.amount} />
                              <AnswerRow label="Member" value={r.answers.memberName} />
                              <AnswerRow label="Note" value={r.answers.note} />
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                              Account facts (verify)
                            </div>
                            <div className="space-y-1.5 text-sm">
                              <div>
                                <span className="text-white/40">Groups: </span>
                                <span className="text-white/85">{r.truth.groups.join(", ") || "—"}</span>
                              </div>
                              <div>
                                <span className="text-white/40">Members: </span>
                                <span className="text-white/85">{r.truth.members.join(", ") || "—"}</span>
                              </div>
                              <div>
                                <span className="text-white/40">Expenses: </span>
                                <span className="text-white/85">
                                  {r.truth.expenses.map((e) => `${e.title} (${e.amount})`).join(", ") || "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            className="!text-rose-300"
                            disabled={busyId === r.id}
                            onClick={() => resolve(r, "reject")}
                          >
                            <X className="h-4 w-4" /> Reject
                          </Button>
                          <Button loading={busyId === r.id} onClick={() => resolve(r, "approve")}>
                            <Check className="h-4 w-4" /> Approve reset
                          </Button>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {resolved.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
                  Recently resolved
                </h2>
                <div className="space-y-2">
                  {resolved.map((r) => (
                    <Card key={r.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{r.user.name}</div>
                        <div className="text-xs text-white/40">
                          {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : ""}
                        </div>
                      </div>
                      <StatusPill status={r.status} />
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
