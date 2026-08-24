import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Bell, Check, Mail, Plus, Users, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Avatar, Button, Card, EmptyState } from "@/components/ui";
import { ShimmerText, SkeletonCard } from "@/components/Shimmer";
import { CreateGroupModal } from "@/components/CreateGroupModal";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@shared/currency";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import type { GroupSummary, PendingInvite, ReminderFrequency, Settlement } from "@shared/types";

// In-app settle-up reminder: gated by the user's chosen frequency using a
// locally-stored "last dismissed" timestamp (no server scheduler needed).
const REMINDER_KEY = "splitplus_reminder_dismissed";
const FREQ_MS: Record<ReminderFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};
function reminderDue(freq: ReminderFrequency): boolean {
  try {
    const last = Number(localStorage.getItem(REMINDER_KEY) ?? 0);
    return Date.now() - last > FREQ_MS[freq];
  } catch {
    return true;
  }
}

type IncomingSettlement = Settlement & {
  group: { id: string; name: string; emoji?: string | null; currency: string };
};

export function HomePage() {
  const { user } = useAuth();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [incoming, setIncoming] = useState<IncomingSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      // Single round-trip instead of 3 parallel requests → fewer serverless
      // cold starts and no connection-pool contention on the remote DB.
      const d = await api.home();
      setGroups(d.groups);
      setInvites(d.invites);
      setIncoming(d.settlements as IncomingSettlement[]);
    } catch {
      /* stay silent on the dashboard */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respondInvite(inv: PendingInvite, action: "accept" | "decline") {
    setInvites((v) => v.filter((x) => x.id !== inv.id));
    try {
      const r = await api.respondInvite(inv.id, action);
      if (action === "accept") {
        success(`Joined "${inv.group.name}"`);
        await load();
        if (r.groupId) navigate(`/g/${r.groupId}`);
      } else {
        success("Invite declined");
      }
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't respond");
      load();
    }
  }

  async function respondSettlement(s: IncomingSettlement, action: "approve" | "decline") {
    setIncoming((v) => v.filter((x) => x.id !== s.id));
    try {
      await api.respondSettlement(s.groupId, s.id, action);
      success(action === "approve" ? "Payment confirmed" : "Payment rejected");
      load();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't respond");
      load();
    }
  }

  const owedCount = groups.filter((g) => g.net > 0.01).length;
  const oweCount = groups.filter((g) => g.net < -0.01).length;

  // Settle-up reminder banner (only when enabled, something's unsettled, due).
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const showReminder = useMemo(() => {
    if (!user?.reminderEnabled || reminderDismissed || loading) return false;
    if (!(oweCount > 0 || owedCount > 0)) return false;
    return reminderDue(user.reminderFrequency);
  }, [user, reminderDismissed, loading, oweCount, owedCount]);

  function dismissReminder() {
    try {
      localStorage.setItem(REMINDER_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setReminderDismissed(true);
  }

  return (
    <div className="min-h-screen pb-28">
      <AppHeader>
        <Button className="!px-3 !py-2 text-sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New group</span>
        </Button>
      </AppHeader>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-white">
            Hey {user?.name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p className="mt-1 text-sm text-white/55">
            {loading ? (
              <ShimmerText>Loading your groups…</ShimmerText>
            ) : groups.length === 0 ? (
              "Create your first group to start splitting."
            ) : (
              <>
                You're in <b className="text-white/80">{groups.length}</b>{" "}
                {groups.length === 1 ? "group" : "groups"}
                {owedCount > 0 && <> · owed in <b className="text-emerald-400">{owedCount}</b></>}
                {oweCount > 0 && <> · you owe in <b className="text-rose-400">{oweCount}</b></>}
              </>
            )}
          </p>
        </motion.div>

        {/* Settle-up reminder */}
        {showReminder && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5">
            <Card className="flex items-center gap-3 border-orange-400/25 p-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-500/20 text-orange-300">
                <Bell className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">Time to settle up</div>
                <div className="truncate text-xs text-white/50">
                  {oweCount > 0 && (
                    <>You owe money in <b className="text-rose-300">{oweCount}</b> {oweCount === 1 ? "group" : "groups"}. </>
                  )}
                  {owedCount > 0 && (
                    <>You're owed in <b className="text-emerald-300">{owedCount}</b>.</>
                  )}
                </div>
              </div>
              <button
                onClick={dismissReminder}
                className="rounded-full bg-white/10 p-2 text-white/60 transition hover:bg-white/20"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </Card>
          </motion.div>
        )}

        {/* Inbox: invites + settlement confirmations */}
        {(invites.length > 0 || incoming.length > 0) && (
          <div className="mt-5 space-y-2">
            {invites.map((inv) => (
              <Card key={inv.id} className="flex items-center gap-3 p-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-xl">
                  {inv.group.emoji ?? "👥"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">
                    {inv.invitedBy.name} invited you to{" "}
                    <span className="text-white">{inv.group.name}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-white/45">
                    <Mail className="h-3 w-3" /> Group invite
                  </div>
                </div>
                <button
                  onClick={() => respondInvite(inv, "accept")}
                  className="rounded-full bg-emerald-500/20 p-2 text-emerald-300 transition hover:bg-emerald-500/30"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => respondInvite(inv, "decline")}
                  className="rounded-full bg-white/10 p-2 text-white/60 transition hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </Card>
            ))}

            {incoming.map((s) => (
              <Card key={s.id} className="flex items-center gap-3 p-3">
                <Avatar name={s.from.name} src={s.from.avatar} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">
                    {s.from.name} paid you {formatMoney(s.group.currency, s.amount)}
                  </div>
                  <div className="truncate text-xs text-white/45">
                    {s.group.emoji} {s.group.name}
                    {s.note ? ` · ${s.note}` : ""} · confirm you received it
                  </div>
                </div>
                <button
                  onClick={() => respondSettlement(s, "approve")}
                  className="rounded-full bg-emerald-500/20 p-2 text-emerald-300 transition hover:bg-emerald-500/30"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => respondSettlement(s, "decline")}
                  className="rounded-full bg-white/10 p-2 text-white/60 transition hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </Card>
            ))}
          </div>
        )}

        {/* Groups grid */}
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
            Your groups
          </h2>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Users className="h-8 w-8" />}
                title="No groups yet"
                subtitle="Start a group for your trip, flat or dinner crew, then invite friends."
                action={
                  <Button className="mt-2" onClick={() => setShowCreate(true)}>
                    <Plus className="h-4 w-4" /> Create a group
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g, idx) => (
                <motion.div
                  key={g.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                >
                  <Link to={`/g/${g.id}`}>
                    <Card className="group overflow-hidden transition hover:-translate-y-1">
                      <div className="relative h-28 w-full overflow-hidden">
                        {g.thumbnail ? (
                          <img src={g.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div
                            className="flex h-full w-full items-center justify-center text-5xl"
                            style={{ background: "linear-gradient(135deg,#3a2a12,#402a1a)" }}
                          >
                            {g.emoji ?? "👥"}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      </div>
                      <div className="p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="truncate font-bold text-white">{g.name}</h3>
                          {g.role === "owner" ? (
                            <span className="pill !py-0.5 text-[10px] text-amber-300">Owner</span>
                          ) : g.role === "moderator" ? (
                            <span className="pill !py-0.5 text-[10px] text-orange-300">Mod</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-white/45">
                          <Users className="h-3.5 w-3.5" /> {g.memberCount}{" "}
                          {g.memberCount === 1 ? "member" : "members"}
                        </div>
                        <div className="mt-3">
                          {Math.abs(g.net) < 0.01 ? (
                            <span className="text-sm font-semibold text-white/60">Settled up ✓</span>
                          ) : g.net > 0 ? (
                            <span className="text-sm font-bold text-emerald-400">
                              you're owed {formatMoney(g.currency, g.net)}
                            </span>
                          ) : (
                            <span className="text-sm font-bold text-rose-400">
                              you owe {formatMoney(g.currency, Math.abs(g.net))}
                            </span>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* FAB */}
      <button
        onClick={() => setShowCreate(true)}
        className="glass-btn-primary fixed bottom-6 right-6 z-30 h-14 w-14 !rounded-full !p-0 shadow-glow"
        aria-label="New group"
      >
        <Plus className="h-6 w-6" />
      </button>

      <CreateGroupModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(g) => setGroups((prev) => [g, ...prev])}
      />
    </div>
  );
}
