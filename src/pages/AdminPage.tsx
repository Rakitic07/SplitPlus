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
  Database,
  FolderCog,
  HardDrive,
  Image,
  LifeBuoy,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Button, Card, EmptyState, Field, Input, PasswordInput } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LogoMark } from "@/components/Logo";
import { CURRENCIES } from "@shared/currency";
import {
  api,
  ApiError,
  type AdminGroup,
  type AdminMetrics,
  type AdminResetRequest,
  type AdminUser,
} from "@/lib/api";
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
  fmt = fmtNum,
}: {
  items: { label: string; value: number; hint?: string }[];
  color?: string;
  fmt?: (n: number) => string;
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
              {fmt(it.value)}
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

// ── storage dashboard ────────────────────────────────────────────────────
function StorageView({ s }: { s: NonNullable<AdminMetrics["storage"]> }) {
  const a = s.attachments;
  // Space the DB uses that isn't one of our own tables (system catalogs, WAL…).
  const tablesBytes = s.tables.reduce((sum, t) => sum + t.bytes, 0);
  const overhead = s.dbBytes !== null ? Math.max(0, s.dbBytes - tablesBytes) : 0;

  return (
    <Card className="p-4">
      <SectionTitle icon={<Database className="h-4 w-4" />}>Storage</SectionTitle>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Database size"
          value={s.dbBytes !== null ? fmtBytes(s.dbBytes) : "n/a"}
          sub={s.provider}
          accent="text-orange-300"
        />
        <Stat label="Images stored" value={fmtNum(a.totalCount)} sub={fmtBytes(a.totalBytes)} />
        <Stat label="Receipts" value={fmtNum(a.receipts.count)} sub={fmtBytes(a.receipts.bytes)} />
        <Stat
          label="Storage left"
          value={
            s.limitBytes !== null && s.dbBytes !== null
              ? fmtBytes(Math.max(0, s.limitBytes - s.dbBytes))
              : "—"
          }
          sub={s.limitBytes !== null ? `of ${fmtBytes(s.limitBytes)}` : "no cap set"}
          accent="text-emerald-400"
        />
      </div>

      {s.limitBytes !== null && s.dbBytes !== null && (
        <div className="mt-4">
          <Meter
            label="Plan usage"
            used={s.dbBytes}
            total={s.limitBytes}
            sub={`${fmtBytes(s.dbBytes)} / ${fmtBytes(s.limitBytes)}`}
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle icon={<Image className="h-4 w-4" />}>Images by type</SectionTitle>
          <BarList
            color="#f59e0b"
            fmt={fmtBytes}
            items={[
              { label: "Avatars", value: a.avatars.bytes, hint: `· ${a.avatars.count}` },
              { label: "Group covers", value: a.groupCovers.bytes, hint: `· ${a.groupCovers.count}` },
              { label: "Receipts", value: a.receipts.bytes, hint: `· ${a.receipts.count}` },
              { label: "Settlement proofs", value: a.settlementProofs.bytes, hint: `· ${a.settlementProofs.count}` },
            ]}
          />
          <p className="mt-2 text-xs text-white/35">Bars show bytes; counts in muted text.</p>
        </div>

        {s.tables.length > 0 && (
          <div>
            <SectionTitle icon={<HardDrive className="h-4 w-4" />}>Tables on disk</SectionTitle>
            <BarList
              color="#a78bfa"
              fmt={fmtBytes}
              items={[
                ...s.tables.slice(0, 8).map((t) => ({ label: t.name, value: t.bytes })),
                ...(overhead > 0 ? [{ label: "system / WAL", value: overhead }] : []),
              ]}
            />
          </div>
        )}
      </div>
    </Card>
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

      {/* Storage */}
      {m.storage && <StorageView s={m.storage} />}

      {/* System */}
      <Card className="p-4">
        <SectionTitle icon={<Cpu className="h-4 w-4" />}>Host & runtime</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <Meter
              label={m.system.memBasis === "process" ? "Memory (function)" : "Memory (host)"}
              used={m.system.memUsedBytes}
              total={m.system.memTotalBytes}
              sub={`RSS ${fmtBytes(m.system.rssBytes)} · ${fmtBytes(m.system.memUsedBytes)} / ${fmtBytes(m.system.memTotalBytes)}`}
            />
            {m.system.loadPct !== null ? (
              <Meter label={`CPU load (${m.system.cpuCores} cores)`} used={m.system.loadPct} total={100} />
            ) : (
              <div className="text-sm">
                <span className="text-white/40">CPU cores: </span>
                <span className="text-white/85">{m.system.cpuCores}</span>
                <span className="ml-2 text-xs text-white/35">(load n/a on serverless)</span>
              </div>
            )}
            {m.system.diskTotalBytes !== null && m.system.diskUsedBytes !== null && (
              <Meter
                label="Disk (writable /tmp)"
                used={m.system.diskUsedBytes}
                total={m.system.diskTotalBytes}
                sub={`${fmtBytes(m.system.diskUsedBytes)} / ${fmtBytes(m.system.diskTotalBytes)}`}
              />
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

// ── search box ────────────────────────────────────────────────────────────
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="!pl-9"
      />
    </div>
  );
}

// ── users management ──────────────────────────────────────────────────────
function UsersView({ secret }: { secret: string }) {
  const { success, error } = useToast();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      try {
        const { users } = await api.adminListUsers(secret, query);
        setUsers(users);
      } catch (err) {
        error(err instanceof ApiError ? err.message : "Couldn't load users");
      } finally {
        setLoading(false);
      }
    },
    [secret, error]
  );

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  async function saveName(u: AdminUser) {
    const name = draft.trim();
    if (!name || name === u.name) {
      setEditingId(null);
      return;
    }
    setSavingId(u.id);
    try {
      const { user } = await api.adminUpdateUser(secret, u.id, name);
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, name: user.name } : x)));
      setEditingId(null);
      success("User renamed");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't rename user");
    } finally {
      setSavingId(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.adminDeleteUser(secret, toDelete.id);
      setUsers((list) => list.filter((x) => x.id !== toDelete.id));
      success(`Deleted ${toDelete.name}`);
      setToDelete(null);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't delete user");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <SearchBox value={q} onChange={setQ} placeholder="Search users by name…" />

      {loading ? (
        <div className="pt-8 text-center text-white/40">Loading users…</div>
      ) : users.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="h-8 w-8" />} title="No users" subtitle="No accounts match your search." />
        </Card>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id} className="p-4">
              {editingId === u.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={40}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName(u);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button className="!px-3" loading={savingId === u.id} onClick={() => saveName(u)}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="!px-3" onClick={() => setEditingId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold text-white">{u.name}</div>
                    <div className="mt-0.5 text-xs text-white/45">
                      {u.ownedGroups} owned · {u.memberships} groups · {u.paidExpenses} paid ·{" "}
                      {new Date(u.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => {
                        setDraft(u.name);
                        setEditingId(u.id);
                      }}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Rename
                    </button>
                    <button
                      onClick={() => setToDelete(u)}
                      className="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={deleting}
        title={`Delete ${toDelete?.name ?? "user"}?`}
        confirmLabel="Delete account"
        message={
          <>
            This permanently removes the account
            {toDelete && toDelete.ownedGroups > 0 && (
              <>
                {" "}
                and the <b>{toDelete.ownedGroups}</b> group{toDelete.ownedGroups > 1 ? "s" : ""} they own
                (with all expenses inside)
              </>
            )}
            . Expenses they paid in other groups are also removed. This can't be undone.
          </>
        }
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

// ── groups management ─────────────────────────────────────────────────────
function GroupsView({ secret }: { secret: string }) {
  const { success, error } = useToast();
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AdminGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      try {
        const { groups } = await api.adminListGroups(secret, query);
        setGroups(groups);
      } catch (err) {
        error(err instanceof ApiError ? err.message : "Couldn't load groups");
      } finally {
        setLoading(false);
      }
    },
    [secret, error]
  );

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  function startEdit(g: AdminGroup) {
    setName(g.name);
    setEmoji(g.emoji ?? "");
    setCurrency(g.currency);
    setEditingId(g.id);
  }

  async function save(g: AdminGroup) {
    const nm = name.trim();
    if (!nm) {
      error("Group name is required");
      return;
    }
    setSavingId(g.id);
    try {
      const { group } = await api.adminUpdateGroup(secret, g.id, {
        name: nm,
        currency,
        emoji: emoji.trim(),
      });
      setGroups((list) =>
        list.map((x) =>
          x.id === g.id ? { ...x, name: group.name, emoji: group.emoji, currency: group.currency } : x
        )
      );
      setEditingId(null);
      success("Group updated");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't update group");
    } finally {
      setSavingId(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.adminDeleteGroup(secret, toDelete.id);
      setGroups((list) => list.filter((x) => x.id !== toDelete.id));
      success(`Deleted ${toDelete.name}`);
      setToDelete(null);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't delete group");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <SearchBox value={q} onChange={setQ} placeholder="Search groups by name…" />

      {loading ? (
        <div className="pt-8 text-center text-white/40">Loading groups…</div>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderCog className="h-8 w-8" />} title="No groups" subtitle="No groups match your search." />
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <Card key={g.id} className="p-4">
              {editingId === g.id ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={emoji}
                      onChange={(e) => setEmoji(e.target.value)}
                      placeholder="👥"
                      maxLength={8}
                      className="!w-16 text-center"
                    />
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={60}
                      autoFocus
                      placeholder="Group name"
                    />
                  </div>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="glass-input appearance-none"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code} className="bg-[#1c1710]">
                        {c.symbol} {c.code} — {c.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button loading={savingId === g.id} onClick={() => save(g)}>
                      <Check className="h-4 w-4" /> Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-2xl">{g.emoji ?? "👥"}</span>
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-white">{g.name}</div>
                      <div className="mt-0.5 text-xs text-white/45">
                        {g.currency} · {g.members} members · {g.expenses} expenses · owner{" "}
                        {g.owner?.name ?? "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => startEdit(g)}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => setToDelete(g)}
                      className="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={deleting}
        title={`Delete ${toDelete?.name ?? "group"}?`}
        confirmLabel="Delete group"
        message={
          <>
            This permanently removes the group and its <b>{toDelete?.expenses ?? 0}</b> expense
            {toDelete?.expenses === 1 ? "" : "s"}, {toDelete?.members ?? 0} membership
            {toDelete?.members === 1 ? "" : "s"}, and all settlements. This can't be undone.
          </>
        }
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────
export function AdminPage() {
  const { success, error } = useToast();
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<"overview" | "users" | "groups" | "requests">("overview");
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
      <header className="pt-safe sticky top-0 z-30 border-b border-white/10 bg-[#0a0807]/70 backdrop-blur-xl">
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
          <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
            {(["overview", "users", "groups", "requests"] as const).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${
                  tab === tb ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                }`}
              >
                {tb === "requests"
                  ? `Recovery${pending.length ? ` (${pending.length})` : ""}`
                  : tb}
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
        ) : tab === "users" ? (
          <UsersView secret={secret} />
        ) : tab === "groups" ? (
          <GroupsView secret={secret} />
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
