import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Download,
  HandCoins,
  ImageIcon,
  Info,
  Pencil,
  Plus,
  Receipt,
  Scale,
  Search,
  Share2,
  Shield,
  ShieldPlus,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Avatar, AvatarStack, Button, Card, EmptyState } from "@/components/ui";
import { ShimmerText, SkeletonRows } from "@/components/Shimmer";
import { ExpenseFormModal } from "@/components/ExpenseFormModal";
import { SettleUpModal } from "@/components/SettleUpModal";
import { InviteModal } from "@/components/InviteModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MembersModal } from "@/components/MembersModal";
import { EditGroupModal } from "@/components/EditGroupModal";
import { ExportModal } from "@/components/ExportModal";
import { BalanceBars, CategoryDonut, PaidByBars, TrendArea } from "@/components/charts";
import { MoneyFlow } from "@/components/MoneyFlow";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@shared/currency";
import { categoryMeta } from "@shared/categories";
import { fmtDay } from "@/lib/utils";
import { useToast } from "@/state/toast";
import type {
  Balance,
  Debt,
  Expense,
  GroupDetail,
  GroupMember,
  GroupStats,
  Role,
  Settlement,
} from "@shared/types";

type Tab = "expenses" | "balances" | "charts" | "activity" | "info";

// Left-to-right order of the tabs, used for swipe navigation and slide direction.
const TAB_ORDER: Tab[] = ["expenses", "balances", "charts", "activity", "info"];

// Horizontal slide used when moving between tabs. `dir` = +1 (moving right /
// next) or -1 (moving left / previous).
const tabSlide = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 48 : -48 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -48 : 48 }),
};

// Detect a mostly-horizontal touch swipe without hijacking vertical scroll.
// Natural paging: left swipe (finger moves ←) advances a tab; right swipe (→) goes back.
function useSwipeNav(onNext: () => void, onPrev: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) onNext();
        else onPrev();
      }
    },
  };
}

export function GroupPage() {
  const { groupId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { success, error } = useToast();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [myNet, setMyNet] = useState(0);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<Tab>("expenses");
  const [tabDir, setTabDir] = useState(0);
  const [showExport, setShowExport] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  // Bumped every time the expense modal opens so it remounts and re-reads the
  // `editing` expense — otherwise its once-only field initialisers keep stale
  // (empty) values and edits don't prefill.
  const [expenseFormKey, setExpenseFormKey] = useState(0);
  const [showSettle, setShowSettle] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmKind, setConfirmKind] = useState<null | "delete" | "leave">(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // Single round-trip instead of 5 parallel requests → fewer serverless
      // cold starts and no connection-pool contention on the remote DB.
      const d = await api.groupBootstrap(groupId);
      setGroup(d.group);
      setExpenses(d.expenses);
      setBalances(d.balances);
      setDebts(d.debts);
      setMyNet(d.myNet);
      setSettlements(d.settlements);
      setStats(d.stats);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't load group");
      if (err instanceof ApiError && err.status === 404) navigate("/");
    } finally {
      setLoading(false);
    }
  }, [groupId, error, navigate]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const openExpense = useCallback(
    async (expenseId: string) => {
      try {
        const { expense } = await api.getExpense(groupId, expenseId);
        setEditing(expense);
        setExpenseFormKey((k) => k + 1);
        setShowExpense(true);
      } catch {
        error("Couldn't open expense");
      }
    },
    [groupId, error]
  );

  // Deep-link from global search: /g/:id?expense=:eid opens that expense once the
  // group has loaded, then strips the param so it doesn't reopen on refresh.
  useEffect(() => {
    const eid = searchParams.get("expense");
    if (!eid || loading || !group) return;
    openExpense(eid);
    const next = new URLSearchParams(searchParams);
    next.delete("expense");
    setSearchParams(next, { replace: true });
  }, [searchParams, loading, group, openExpense, setSearchParams]);

  async function deleteExpense(expense: Expense) {
    if (!confirm(`Delete "${expense.title}"?`)) return;
    try {
      await api.deleteExpense(groupId, expense.id);
      success("Expense deleted");
      setShowExpense(false);
      setEditing(null);
      refresh();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't delete");
    }
  }

  async function respondSettlement(s: Settlement, action: "approve" | "decline") {
    try {
      await api.respondSettlement(groupId, s.id, action);
      success(action === "approve" ? "Payment confirmed" : "Payment rejected");
      refresh();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't respond");
    }
  }

  async function runConfirm() {
    if (!group || !confirmKind) return;
    setConfirmBusy(true);
    try {
      if (confirmKind === "delete") {
        await api.deleteGroup(group.id);
        success("Group deleted");
      } else {
        await api.leaveGroup(group.id);
        success("You left the group");
      }
      navigate("/");
    } catch (err) {
      error(
        err instanceof ApiError
          ? err.message
          : confirmKind === "delete"
            ? "Couldn't delete group"
            : "Couldn't leave group"
      );
    } finally {
      setConfirmBusy(false);
      setConfirmKind(null);
    }
  }

  async function changeRole(member: GroupMember, role: Exclude<Role, "owner">) {
    if (!group) return;
    try {
      await api.setMemberRole(group.id, member.id, role);
      success(
        role === "moderator"
          ? `${member.name} is now a moderator`
          : `${member.name} is no longer a moderator`
      );
      refresh();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't update role");
    }
  }

  const currency = group?.currency ?? "INR";
  const elevated = group?.role === "owner" || group?.role === "moderator";

  // Switch to a specific tab, remembering the slide direction.
  const goTab = useCallback(
    (next: Tab) => {
      setTabDir(TAB_ORDER.indexOf(next) >= TAB_ORDER.indexOf(tab) ? 1 : -1);
      setTab(next);
    },
    [tab]
  );
  // Step one tab over (used by swipe): delta +1 = next, -1 = previous.
  const shiftTab = useCallback(
    (delta: number) => {
      const i = TAB_ORDER.indexOf(tab);
      const j = Math.min(TAB_ORDER.length - 1, Math.max(0, i + delta));
      if (j !== i) {
        setTabDir(delta);
        setTab(TAB_ORDER[j]);
      }
    },
    [tab]
  );
  const swipe = useSwipeNav(
    () => shiftTab(1),
    () => shiftTab(-1)
  );

  return (
    <div className="min-h-screen pb-28">
      {/* Cover header */}
      <div className="relative h-44 w-full overflow-hidden sm:h-52">
        {group?.thumbnail ? (
          <img src={group.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-7xl"
            style={{ background: "linear-gradient(135deg,#3a2a12,#402a1a,#20180e)" }}
          >
            {group?.emoji ?? "👥"}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0807] via-[#0a0807]/40 to-transparent" />

        <div className="pt-safe-bar absolute left-0 right-0 top-0 flex items-center justify-between px-4 pb-4">
          <button
            onClick={() => navigate("/")}
            className="glass rounded-full p-2 text-white/90 transition hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowExport(true)}
              title="Download expenses"
              className="glass flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white/90"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
            {elevated && (
              <>
                <button
                  onClick={() => setShowEdit(true)}
                  title="Edit group"
                  className="glass flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white/90"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
                <button
                  onClick={() => setShowInvite(true)}
                  className="glass flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white/90"
                >
                  <UserPlus className="h-4 w-4" /> Invite
                </button>
              </>
            )}
          </div>
        </div>

        <div className="absolute bottom-3 left-4 right-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black text-white drop-shadow">
                {group ? (
                  <>
                    {group.emoji} {group.name}
                  </>
                ) : (
                  <ShimmerText>Loading…</ShimmerText>
                )}
              </h1>
              {group && (
                <button
                  type="button"
                  onClick={() => setShowMembers(true)}
                  className="mt-1 flex items-center gap-2 rounded-full py-0.5 pr-2 transition hover:bg-white/10"
                  title="View members"
                >
                  <AvatarStack people={group.members} max={2} showOverflow={false} />
                  <span className="text-xs text-white/60 underline-offset-2 hover:text-white/90 hover:underline">
                    {group.members.length} {group.members.length === 1 ? "member" : "members"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4">
        {/* My balance banner */}
        <Card strong className="-mt-2 flex items-center justify-between gap-3 p-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/40">Your balance</div>
            {loading ? (
              <ShimmerText className="text-lg">Calculating…</ShimmerText>
            ) : Math.abs(myNet) < 0.01 ? (
              <div className="text-lg font-bold text-white/80">You're all settled up ✓</div>
            ) : myNet > 0 ? (
              <div className="text-lg font-bold text-emerald-400">
                You're owed {formatMoney(currency, myNet)}
              </div>
            ) : (
              <div className="text-lg font-bold text-rose-400">
                You owe {formatMoney(currency, Math.abs(myNet))}
              </div>
            )}
          </div>
          <Button className="!px-4 !py-2.5 text-sm" onClick={() => setShowSettle(true)}>
            <HandCoins className="h-4 w-4" /> Settle up
          </Button>
        </Card>

        {/* Tabs */}
        <div className="mt-4 grid grid-cols-5 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1">
          {([
            { k: "expenses", label: "Expenses", icon: <Receipt className="h-4 w-4" /> },
            { k: "balances", label: "Balances", icon: <Scale className="h-4 w-4" /> },
            { k: "charts", label: "Charts", icon: <BarChart3 className="h-4 w-4" /> },
            { k: "activity", label: "Activity", icon: <Clock className="h-4 w-4" /> },
            { k: "info", label: "Info", icon: <Info className="h-4 w-4" /> },
          ] as { k: Tab; label: string; icon: React.ReactNode }[]).map((t) => (
            <button
              key={t.k}
              onClick={() => goTab(t.k)}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition sm:text-sm ${
                tab === t.k ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-hidden" {...swipe}>
          {loading ? (
            <Card className="p-2">
              <SkeletonRows count={6} />
            </Card>
          ) : !group ? null : (
            <AnimatePresence mode="wait" custom={tabDir} initial={false}>
              <motion.div
                key={tab}
                custom={tabDir}
                variants={tabSlide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {tab === "expenses" ? (
                  <ExpensesTab
                    expenses={expenses}
                    currency={currency}
                    myId={group.myUserId}
                    onOpen={openExpense}
                  />
                ) : tab === "balances" ? (
                  <BalancesTab
                    balances={balances}
                    debts={debts}
                    currency={currency}
                    myId={group.myUserId}
                    onSettle={() => setShowSettle(true)}
                  />
                ) : tab === "charts" ? (
                  <ChartsTab
                    expenses={expenses}
                    balances={balances}
                    debts={debts}
                    currency={currency}
                  />
                ) : tab === "activity" ? (
                  <ActivityTab
                    expenses={expenses}
                    settlements={settlements}
                    currency={currency}
                    myId={group.myUserId}
                    onRespond={respondSettlement}
                    onOpenExpense={openExpense}
                  />
                ) : (
                  <InfoTab
                    group={group}
                    stats={stats}
                    currency={currency}
                    elevated={elevated}
                    onChangeRole={changeRole}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Owner / member actions */}
        {group && (
          <div className="mt-8 flex justify-center">
            {group.role === "owner" ? (
              <button
                onClick={() => setConfirmKind("delete")}
                className="flex items-center gap-1.5 text-sm text-rose-400/70 transition hover:text-rose-400"
              >
                <Trash2 className="h-4 w-4" /> Delete group
              </button>
            ) : (
              <button
                onClick={() => setConfirmKind("leave")}
                className="flex items-center gap-1.5 text-sm text-white/40 transition hover:text-white/70"
              >
                Leave group
              </button>
            )}
          </div>
        )}
      </main>

      {/* Add expense FAB */}
      {group && (
        <button
          onClick={() => {
            setEditing(null);
            setExpenseFormKey((k) => k + 1);
            setShowExpense(true);
          }}
          className="glass-btn-primary fixed bottom-6 right-6 z-30 flex h-14 items-center gap-2 !rounded-full !px-5 shadow-glow"
        >
          <Plus className="h-5 w-5" /> Add
        </button>
      )}

      {group && (
        <>
          <ExpenseFormModal
            key={expenseFormKey}
            open={showExpense}
            onClose={() => {
              setShowExpense(false);
              setEditing(null);
            }}
            group={group}
            editing={editing}
            onSaved={refresh}
            onDelete={deleteExpense}
          />
          <SettleUpModal
            open={showSettle}
            onClose={() => setShowSettle(false)}
            group={group}
            debts={debts}
            onDone={refresh}
          />
          <InviteModal
            open={showInvite}
            onClose={() => setShowInvite(false)}
            groupId={group.id}
            groupName={group.name}
          />
          <EditGroupModal
            open={showEdit}
            onClose={() => setShowEdit(false)}
            group={group}
            onSaved={refresh}
          />
          <ExportModal
            open={showExport}
            onClose={() => setShowExport(false)}
            scope="group"
            group={group}
            expenses={expenses}
          />
          <ConfirmDialog
            open={confirmKind !== null}
            danger
            loading={confirmBusy}
            title={confirmKind === "delete" ? "Delete this group?" : "Leave this group?"}
            message={
              confirmKind === "delete" ? (
                <>
                  This permanently deletes <b className="text-white">{group.name}</b> along with all its
                  expenses, balances and settlements. This <b>can't be undone</b>.
                </>
              ) : (
                <>
                  Are you sure you want to leave <b className="text-white">{group.name}</b>? You'll lose
                  access to its expenses and balances.
                </>
              )
            }
            confirmLabel={confirmKind === "delete" ? "Delete group" : "Leave group"}
            onConfirm={runConfirm}
            onCancel={() => setConfirmKind(null)}
          />
          <MembersModal
            open={showMembers}
            onClose={() => setShowMembers(false)}
            members={group.members}
            myUserId={group.myUserId}
          />
        </>
      )}
    </div>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

// How many rows a paginated list shows at once.
const PAGE_SIZE = 5;

// A compact, theme-matched search input used inside the group tabs.
function SearchField({
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
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="glass-input !pl-10"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 transition hover:text-white/80"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Prev / next pager with an "X–Y of N" summary. Hidden when a single page.
function Pager({
  page,
  pageCount,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (pageCount <= 1) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-xs text-white/45">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onPrev}
          disabled={page <= 0}
          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 transition enabled:hover:bg-white/10 disabled:opacity-35"
        >
          <ChevronLeft className="h-4 w-4" /> Newer
        </button>
        <button
          onClick={onNext}
          disabled={page >= pageCount - 1}
          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 transition enabled:hover:bg-white/10 disabled:opacity-35"
        >
          Older <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ExpensesTab({
  expenses,
  currency,
  myId,
  onOpen,
}: {
  expenses: Expense[];
  currency: string;
  myId: string;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return expenses;
    return expenses.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.notes ?? "").toLowerCase().includes(q) ||
        e.paidBy.name.toLowerCase().includes(q)
    );
  }, [expenses, q]);

  useEffect(() => setPage(0), [q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount - 1);
  const slice = filtered.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);

  if (expenses.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Receipt className="h-8 w-8" />}
          title="No expenses yet"
          subtitle="Tap “Add” to log your first shared expense and split it however you like."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <SearchField value={query} onChange={setQuery} placeholder="Search this group's expenses…" />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No matches"
            subtitle={`Nothing matches “${query.trim()}”. Try a different word.`}
          />
        </Card>
      ) : (
        <Card className="divide-y divide-white/5 p-1">
          {slice.map((e, i) => {
        const cat = categoryMeta(e.category);
        const myShare = e.shares.find((s) => s.userId === myId)?.amount ?? 0;
        const iPaid = e.paidBy.id === myId ? e.amount : 0;
        const net = iPaid - myShare;
        return (
          <motion.button
            key={e.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: Math.min(i * 0.02, 0.3) }}
            onClick={() => onOpen(e.id)}
            className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/5"
          >
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl"
              style={{ background: `${cat.color}26` }}
            >
              {cat.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-white">{e.title}</span>
                {e.hasThumbnail && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-white/40" />}
              </div>
              <div className="truncate text-xs text-white/45">
                {e.paidBy.id === myId ? "You" : e.paidBy.name} paid{" "}
                {formatMoney(currency, e.amount)} · {fmtDay(e.date)}
              </div>
            </div>
            <div className="text-right">
              {Math.abs(net) < 0.01 ? (
                <div className="text-xs text-white/40">not involved</div>
              ) : net > 0 ? (
                <>
                  <div className="text-xs text-emerald-400/80">you lent</div>
                  <div className="font-bold text-emerald-400">{formatMoney(currency, net)}</div>
                </>
              ) : (
                <>
                  <div className="text-xs text-rose-400/80">you borrowed</div>
                  <div className="font-bold text-rose-400">{formatMoney(currency, Math.abs(net))}</div>
                </>
              )}
            </div>
          </motion.button>
        );
      })}
        </Card>
      )}

      <Pager
        page={clamped}
        pageCount={pageCount}
        total={filtered.length}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
      />
    </div>
  );
}

function BalancesTab({
  balances,
  debts,
  currency,
  myId,
  onSettle,
}: {
  balances: Balance[];
  debts: Debt[];
  currency: string;
  myId: string;
  onSettle: () => void;
}) {
  const active = balances.filter((b) => Math.abs(b.net) > 0.01);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">
            Who owes whom
          </h3>
          <Button className="!px-3 !py-1.5 text-xs" onClick={onSettle}>
            <HandCoins className="h-3.5 w-3.5" /> Settle
          </Button>
        </div>
        {debts.length === 0 ? (
          <div className="py-6 text-center text-sm text-white/50">Everyone's settled up 🎉</div>
        ) : (
          <div className="space-y-2">
            {debts.map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5"
              >
                <Avatar name={d.fromName} size={30} />
                <span className={`text-sm font-semibold ${d.fromId === myId ? "text-rose-300" : "text-white/80"}`}>
                  {d.fromId === myId ? "You" : d.fromName}
                </span>
                <ArrowRight className="h-4 w-4 text-white/30" />
                <Avatar name={d.toName} size={30} />
                <span className={`text-sm font-semibold ${d.toId === myId ? "text-emerald-300" : "text-white/80"}`}>
                  {d.toId === myId ? "You" : d.toName}
                </span>
                <span className="ml-auto font-bold text-white">{formatMoney(currency, d.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
          Member balances
        </h3>
        {active.length === 0 ? (
          <div className="py-4 text-center text-sm text-white/50">No outstanding balances.</div>
        ) : (
          <div className="space-y-1.5">
            {active
              .sort((a, b) => b.net - a.net)
              .map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-1 py-1.5">
                  <Avatar name={b.name} src={b.avatar} size={32} />
                  <span className="flex-1 truncate text-sm text-white/80">
                    {b.id === myId ? "You" : b.name}
                  </span>
                  <span className={`font-bold ${b.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {b.net >= 0 ? "+" : "−"}
                    {formatMoney(currency, Math.abs(b.net))}
                  </span>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ChartsTab({
  expenses,
  balances,
  debts,
  currency,
}: {
  expenses: Expense[];
  balances: Balance[];
  debts: Debt[];
  currency: string;
}) {
  if (expenses.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<BarChart3 className="h-8 w-8" />}
          title="No data to chart yet"
          subtitle="Add a few expenses and beautiful charts will appear here."
        />
      </Card>
    );
  }
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <Share2 className="h-4 w-4 text-orange-300" />
          <h3 className="text-sm font-semibold text-white/70">Money flow — who pays whom</h3>
        </div>
        <p className="mb-1 text-xs text-white/40">
          The netted settle-up map. Bigger circle = bigger balance; dots stream toward whoever's owed.
        </p>
        <MoneyFlow balances={balances} debts={debts} currency={currency} />
      </Card>
      <Card className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/70">Spending by category</h3>
          <span className="text-sm font-bold text-white">{formatMoney(currency, total)}</span>
        </div>
        <CategoryDonut expenses={expenses} currency={currency} />
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-white/70">Who paid the most</h3>
          <PaidByBars expenses={expenses} currency={currency} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-white/70">Net balances</h3>
          <BalanceBars balances={balances} currency={currency} />
        </Card>
      </div>
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-white/70">Spending over time</h3>
        <TrendArea expenses={expenses} currency={currency} />
      </Card>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "owner") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
        <Crown className="h-3 w-3" /> Owner
      </span>
    );
  }
  if (role === "moderator") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-orange-400/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300">
        <Shield className="h-3 w-3" /> Mod
      </span>
    );
  }
  return null;
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-white/45">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-1.5 text-xl font-black text-white">{value}</div>
      {sub && <div className="text-xs text-white/45">{sub}</div>}
    </Card>
  );
}

function InfoTab({
  group,
  stats,
  currency,
  elevated,
  onChangeRole,
}: {
  group: GroupDetail;
  stats: GroupStats | null;
  currency: string;
  elevated: boolean;
  onChangeRole: (member: GroupMember, role: Exclude<Role, "owner">) => void;
}) {
  const isOwner = group.role === "owner";
  const basic = stats?.basic;
  const advanced = stats?.advanced;
  const created = new Date(group.createdAt);
  const fmtFull = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "—";

  return (
    <div className="space-y-4">
      {/* About */}
      <Card className="p-4">
        <div className="flex items-center gap-2 text-white/45">
          <CalendarDays className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">About this group</span>
        </div>
        <div className="mt-2 text-sm text-white/80">
          Created on{" "}
          <b className="text-white">
            {created.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
          </b>
          {group.createdBy && (
            <>
              {" "}
              by <b className="text-white">{group.createdBy.name}</b>
            </>
          )}
          .
        </div>
      </Card>

      {/* Basic metrics — visible to everyone */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric
          icon={<Receipt className="h-4 w-4" />}
          label="Total spent"
          value={basic ? formatMoney(currency, basic.totalSpent) : "—"}
          sub={basic ? `${basic.expenseCount} ${basic.expenseCount === 1 ? "expense" : "expenses"}` : undefined}
        />
        <Metric
          icon={<Users className="h-4 w-4" />}
          label="Members"
          value={basic ? String(basic.memberCount) : "—"}
        />
        <Metric
          icon={<HandCoins className="h-4 w-4" />}
          label="You paid"
          value={basic ? formatMoney(currency, basic.myPaid) : "—"}
          sub={basic ? `your share ${formatMoney(currency, basic.myShare)}` : undefined}
        />
        <Metric
          icon={<Check className="h-4 w-4" />}
          label="Settled"
          value={basic ? String(basic.settledCount) : "—"}
          sub={basic && basic.pendingSettlements > 0 ? `${basic.pendingSettlements} pending` : undefined}
        />
        <Metric
          icon={<CalendarDays className="h-4 w-4" />}
          label="First expense"
          value={fmtFull(basic?.firstExpenseAt)}
        />
        <Metric
          icon={<Clock className="h-4 w-4" />}
          label="Last activity"
          value={fmtFull(basic?.lastActivityAt)}
        />
      </div>

      {/* Advanced metrics — owner & moderators only */}
      {elevated && advanced && (
        <>
          <div className="flex items-center gap-2 px-1 pt-2 text-white/45">
            <Award className="h-4 w-4 text-orange-300" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Advanced insights
            </span>
            <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300">
              owner &amp; mods
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              icon={<BarChart3 className="h-4 w-4" />}
              label="Avg expense"
              value={formatMoney(currency, advanced.avgExpense)}
            />
            <Metric
              icon={<Receipt className="h-4 w-4" />}
              label="Largest"
              value={formatMoney(currency, advanced.largestExpense)}
            />
            <Metric
              icon={<CalendarDays className="h-4 w-4" />}
              label="Active days"
              value={String(advanced.activeDays)}
            />
            <Metric
              icon={<HandCoins className="h-4 w-4" />}
              label="Settled volume"
              value={formatMoney(currency, advanced.settlementVolume)}
            />
          </div>

          {advanced.topSpender && (
            <Card className="flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
                <Crown className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wider text-white/40">Top spender</div>
                <div className="truncate font-bold text-white">{advanced.topSpender.name}</div>
              </div>
              <div className="font-black text-white">
                {formatMoney(currency, advanced.topSpender.amount)}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
              Per-member breakdown
            </h3>
            <div className="space-y-1.5">
              {advanced.perMember.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-1 py-1.5">
                  <Avatar name={m.name} src={m.avatar} size={30} />
                  <span className="min-w-0 flex-1 truncate text-sm text-white/80">
                    {m.id === group.myUserId ? "You" : m.name}
                  </span>
                  <div className="text-right">
                    <div className="text-xs text-white/40">
                      paid {formatMoney(currency, m.paid)}
                    </div>
                    <div
                      className={`text-xs font-semibold ${
                        m.net >= 0 ? "text-emerald-400/80" : "text-rose-400/80"
                      }`}
                    >
                      net {m.net >= 0 ? "+" : "−"}
                      {formatMoney(currency, Math.abs(m.net))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {advanced.categories.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
                By category
              </h3>
              <div className="space-y-1.5">
                {advanced.categories.map((c) => {
                  const meta = categoryMeta(c.name);
                  return (
                    <div key={c.name} className="flex items-center gap-3 px-1 py-1">
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-base"
                        style={{ background: `${meta.color}26` }}
                      >
                        {meta.emoji}
                      </span>
                      <span className="flex-1 truncate text-sm text-white/75">{c.name}</span>
                      <span className="font-semibold text-white">
                        {formatMoney(currency, c.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Members + role management */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
          Members
        </h3>
        <div className="space-y-1">
          {group.members.map((m) => {
            const isSelf = m.id === group.myUserId;
            const canManage = isOwner && !isSelf && m.role !== "owner";
            return (
              <div key={m.id} className="flex items-center gap-3 rounded-2xl px-1 py-2">
                <Avatar name={m.name} src={m.avatar} size={36} />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white/85">
                    {isSelf ? "You" : m.name}
                  </span>
                  <RoleBadge role={m.role} />
                </div>
                {canManage &&
                  (m.role === "moderator" ? (
                    <button
                      onClick={() => onChangeRole(m, "member")}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/60 transition hover:bg-white/10"
                    >
                      <Shield className="h-3 w-3" /> Remove mod
                    </button>
                  ) : (
                    <button
                      onClick={() => onChangeRole(m, "moderator")}
                      className="flex items-center gap-1 rounded-full border border-orange-400/25 bg-orange-500/10 px-2.5 py-1 text-xs font-semibold text-orange-300 transition hover:bg-orange-500/20"
                    >
                      <ShieldPlus className="h-3 w-3" /> Make mod
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
        {isOwner && (
          <p className="mt-3 text-center text-xs text-white/30">
            Moderators can invite members and edit group details.
          </p>
        )}
      </Card>
    </div>
  );
}

type ActivityItem =
  | { kind: "expense"; id: string; at: string; exp: Expense }
  | { kind: "settlement"; id: string; at: string; st: Settlement };

function ActivityTab({
  expenses,
  settlements,
  currency,
  myId,
  onRespond,
  onOpenExpense,
}: {
  expenses: Expense[];
  settlements: Settlement[];
  currency: string;
  myId: string;
  onRespond: (s: Settlement, action: "approve" | "decline") => void;
  onOpenExpense: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  // 0 = current month, -1 = last month, … (only used when not searching).
  const [monthOffset, setMonthOffset] = useState(0);
  const [page, setPage] = useState(0);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // First day of the month currently in view.
  const monthStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);
  const monthLabel = monthStart.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  // Unified, newest-first feed: expenses added + settlements/payments.
  const items = useMemo<ActivityItem[]>(() => {
    const ex: ActivityItem[] = expenses.map((e) => ({
      kind: "expense",
      id: `e-${e.id}`,
      at: e.createdAt,
      exp: e,
    }));
    const se: ActivityItem[] = settlements.map((s) => ({
      kind: "settlement",
      id: `s-${s.id}`,
      at: s.createdAt,
      st: s,
    }));
    return [...ex, ...se].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }, [expenses, settlements]);

  const filtered = useMemo(() => {
    if (searching) {
      return items.filter((it) => {
        if (it.kind === "expense") {
          const e = it.exp;
          return (
            e.title.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            (e.notes ?? "").toLowerCase().includes(q) ||
            e.paidBy.name.toLowerCase().includes(q)
          );
        }
        const s = it.st;
        return (
          s.from.name.toLowerCase().includes(q) ||
          s.to.name.toLowerCase().includes(q) ||
          (s.note ?? "").toLowerCase().includes(q) ||
          s.status.toLowerCase().includes(q)
        );
      });
    }
    return items.filter((it) => {
      const d = new Date(it.at);
      return (
        d.getFullYear() === monthStart.getFullYear() && d.getMonth() === monthStart.getMonth()
      );
    });
  }, [items, q, searching, monthStart]);

  useEffect(() => setPage(0), [q, monthOffset]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount - 1);
  const slice = filtered.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);

  const statusStyle: Record<string, string> = {
    pending: "text-amber-300",
    approved: "text-emerald-400",
    declined: "text-rose-400",
  };

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Clock className="h-8 w-8" />}
          title="No activity yet"
          subtitle="Add an expense or settle up — everything that happens in this group shows here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search activity by title, name, note…"
      />

      {/* Month/year navigator — hidden while searching (results span all months). */}
      {!searching && (
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
          <button
            onClick={() => setMonthOffset((m) => m - 1)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-white/70 transition hover:bg-white/10"
          >
            <ChevronLeft className="h-4 w-4" /> Older
          </button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <CalendarDays className="h-4 w-4 text-white/50" /> {monthLabel}
          </span>
          <button
            onClick={() => setMonthOffset((m) => Math.min(0, m + 1))}
            disabled={monthOffset >= 0}
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-white/70 transition enabled:hover:bg-white/10 disabled:opacity-35"
          >
            Newer <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={searching ? <Search className="h-8 w-8" /> : <Clock className="h-8 w-8" />}
            title={searching ? "No matches" : "No activity"}
            subtitle={
              searching
                ? `Nothing matches “${query.trim()}”.`
                : `Nothing happened in ${monthLabel}.`
            }
          />
        </Card>
      ) : (
        <Card className="divide-y divide-white/5 p-1">
          {slice.map((it) => {
            if (it.kind === "expense") {
              const e = it.exp;
              const cat = categoryMeta(e.category);
              return (
                <button
                  key={it.id}
                  onClick={() => onOpenExpense(e.id)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/5"
                >
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl text-lg"
                    style={{ background: `${cat.color}26` }}
                  >
                    {cat.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">
                      {e.paidBy.id === myId ? "You" : e.paidBy.name} added “{e.title}”
                    </div>
                    <div className="truncate text-xs text-white/45">
                      {fmtDay(e.createdAt)} · {cat.name}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-white">
                    {formatMoney(currency, e.amount)}
                  </div>
                </button>
              );
            }

            const s = it.st;
            const canAct = s.status === "pending" && s.to.id === myId;
            return (
              <div key={it.id} className="flex items-center gap-3 px-3 py-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
                  <HandCoins className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">
                    {s.from.id === myId ? "You" : s.from.name} paid{" "}
                    {s.to.id === myId ? "you" : s.to.name} {formatMoney(currency, s.amount)}
                  </div>
                  <div className="truncate text-xs text-white/45">
                    {fmtDay(s.createdAt)}
                    {s.note ? ` · ${s.note}` : ""} ·{" "}
                    <span className={statusStyle[s.status]}>{s.status}</span>
                  </div>
                </div>
                {canAct ? (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => onRespond(s, "approve")}
                      className="rounded-full bg-emerald-500/20 p-2 text-emerald-300 transition hover:bg-emerald-500/30"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onRespond(s, "decline")}
                      className="rounded-full bg-white/10 p-2 text-white/60 transition hover:bg-white/20"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : s.status === "pending" ? (
                  <span className="flex items-center gap-1 text-xs text-amber-300">
                    <Clock className="h-3 w-3" /> waiting
                  </span>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}

      <Pager
        page={clamped}
        pageCount={pageCount}
        total={filtered.length}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
      />
    </div>
  );
}
