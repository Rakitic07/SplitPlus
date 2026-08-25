import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Avatar, Button, Card, Empty, Input, Label, SectionTitle } from "../components/ui";
import { ExportSheet } from "../components/ExportSheet";
import { MembersSheet } from "../components/MembersSheet";
import { EditGroupSheet } from "../components/EditGroupSheet";
import { ShimmerText, SkeletonRows } from "../components/Shimmer";
import { BalanceBars, CategoryDonut, PaidByBars } from "../components/charts";
import { api, ApiError, APP_URL } from "../lib/api";
import { formatMoney } from "../shared/currency";
import { categoryMeta } from "../shared/categories";
import { fmtDay } from "../lib/utils";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { RootStackParamList } from "../navigation";
import type {
  Balance,
  Debt,
  Expense,
  GroupDetail,
  GroupStats,
  PublicUser,
  Role,
  Settlement,
} from "../shared/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "Group">;
type Rt = RouteProp<RootStackParamList, "Group">;
type Tab = "expenses" | "balances" | "charts" | "activity" | "info";

// Left-to-right tab order, used for swipe navigation + slide direction.
const TAB_ORDER: Tab[] = ["expenses", "balances", "charts", "activity", "info"];
// How many rows to show per page in the paginated lists.
const PAGE_SIZE = 5;

const TAB_LABEL: Record<Tab, string> = {
  expenses: "Expenses",
  balances: "Balances",
  charts: "Charts",
  activity: "Activity",
  info: "Info",
};

export function GroupScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();
  const { groupId } = route.params;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [myNet, setMyNet] = useState(0);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("expenses");
  const [showInvite, setShowInvite] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  // Horizontal slide + fade played whenever the active tab changes.
  const slide = useRef(new Animated.Value(0)).current;
  const selectTab = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      const dir = TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1;
      // New tab enters from the side it's coming from and eases to rest.
      slide.setValue(dir * 48);
      setTab(next);
      Animated.timing(slide, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [tab, slide]
  );
  // Step one tab over (used by swipe): +1 = next (right), -1 = previous (left).
  const shiftTab = useCallback(
    (delta: number) => {
      const i = TAB_ORDER.indexOf(tab);
      const j = Math.min(TAB_ORDER.length - 1, Math.max(0, i + delta));
      if (j !== i) selectTab(TAB_ORDER[j]);
    },
    [tab, selectTab]
  );
  // Recognise a mostly-horizontal swipe without hijacking vertical scroll.
  // Natural paging: swipe LEFT → next tab (content pages to the right),
  // swipe RIGHT → previous tab. A quick flick counts too, so it feels
  // friction-free rather than needing a long drag.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 14])
        .failOffsetY([-14, 14])
        .onEnd((e) => {
          const far = Math.abs(e.translationX) > 42;
          const flick = Math.abs(e.velocityX) > 320;
          if ((far || flick) && Math.abs(e.translationX) > Math.abs(e.translationY)) {
            if (e.translationX < 0) shiftTab(1);
            else shiftTab(-1);
          }
        }),
    [shiftTab]
  );

  const load = useCallback(async () => {
    try {
      // Single combined round-trip (detail + expenses + balances + settlements
      // + stats) instead of five parallel requests — much faster on cold start.
      const d = await api.groupBootstrap(groupId);
      setGroup(d.group);
      setExpenses(d.expenses);
      setBalances(d.balances);
      setDebts(d.debts);
      setMyNet(d.myNet);
      setSettlements(d.settlements);
      setStats(d.stats ?? null);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't load group");
      if (err instanceof ApiError && err.status === 404) nav.goBack();
    } finally {
      setLoading(false);
    }
  }, [groupId, error, nav]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const currency = group?.currency ?? "INR";
  const myId = group?.myUserId ?? "";
  const elevated = group?.role === "owner" || group?.role === "moderator";

  async function changeRole(member: PublicUser, role: Exclude<Role, "owner">) {
    try {
      await api.setMemberRole(groupId, member.id, role);
      success(role === "moderator" ? `${member.name} is now a moderator` : `${member.name} is now a member`);
      load();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't change role");
    }
  }

  async function respondSettlement(s: Settlement, action: "approve" | "decline") {
    try {
      await api.respondSettlement(groupId, s.id, action);
      success(action === "approve" ? "Payment confirmed" : "Payment rejected");
      load();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't respond");
    }
  }

  function confirmDelete() {
    if (!group) return;
    const owner = group.role === "owner";
    Alert.alert(
      owner ? "Delete group?" : "Leave group?",
      owner ? `This permanently deletes "${group.name}".` : `Leave "${group.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: owner ? "Delete" : "Leave",
          style: "destructive",
          onPress: async () => {
            try {
              if (owner) await api.deleteGroup(group.id);
              else await api.leaveGroup(group.id);
              success(owner ? "Group deleted" : "You left the group");
              nav.goBack();
            } catch (err) {
              error(err instanceof ApiError ? err.message : "Action failed");
            }
          },
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Cover */}
      <View style={{ height: 200 }}>
        {group?.thumbnail ? (
          <Image source={{ uri: group.thumbnail }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <LinearGradient colors={theme.gradients.cover} style={styles.coverFallback}>
            <Text style={{ fontSize: 64 }}>{group?.emoji ?? "👥"}</Text>
          </LinearGradient>
        )}
        <LinearGradient colors={["transparent", theme.colors.bg]} style={styles.coverFade} />
        <View style={[styles.coverTop, { top: insets.top + 6 }]}>
          <Pressable style={styles.roundBtn} onPress={() => nav.goBack()}>
            <Text style={styles.roundTxt}>‹</Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {elevated && (
              <Pressable style={styles.invite} onPress={() => setShowEdit(true)}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>✎ Edit</Text>
              </Pressable>
            )}
            <Pressable style={styles.invite} onPress={() => setShowExport(true)}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>⇩ Export</Text>
            </Pressable>
            <Pressable style={styles.invite} onPress={() => setShowInvite(true)}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>+ Invite</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.coverTitle}>
          <Text style={styles.title} numberOfLines={1}>
            {group ? `${group.emoji ?? ""} ${group.name}` : "…"}
          </Text>
          {group && (
            <Pressable onPress={() => setShowMembers(true)} hitSlop={8}>
              <Text style={styles.members}>
                {group.members.length} {group.members.length === 1 ? "member" : "members"} ›
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130 }}>
        {/* Balance banner */}
        <Card strong style={{ padding: 16, marginTop: -6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerLabel}>Your balance</Text>
            {loading ? (
              <ShimmerText style={{ fontSize: 18 }}>Calculating…</ShimmerText>
            ) : (
              <Text
                style={[
                  styles.bannerVal,
                  { color: Math.abs(myNet) < 0.01 ? theme.colors.textDim : myNet > 0 ? theme.colors.green : theme.colors.red },
                ]}
              >
                {Math.abs(myNet) < 0.01
                  ? "All settled up ✓"
                  : myNet > 0
                  ? `You're owed ${formatMoney(currency, myNet)}`
                  : `You owe ${formatMoney(currency, Math.abs(myNet))}`}
              </Text>
            )}
          </View>
          <Button title="Settle up" onPress={() => nav.navigate("Settle", { groupId })} style={{ paddingVertical: 10, paddingHorizontal: 14 }} />
        </Card>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TAB_ORDER.map((t) => (
            <Pressable key={t} onPress={() => selectTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
              <Text numberOfLines={1} style={[styles.tabText, tab === t && { color: "#fff" }]}>
                {TAB_LABEL[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        <GestureDetector gesture={swipe}>
          <Animated.View
            style={{
              marginTop: 14,
              transform: [{ translateX: slide }],
              opacity: slide.interpolate({
                inputRange: [-48, 0, 48],
                outputRange: [0.35, 1, 0.35],
              }),
            }}
          >
          {loading ? (
            <Card style={{ padding: 8 }}>
              <SkeletonRows count={5} />
            </Card>
          ) : !group ? null : tab === "expenses" ? (
            <ExpensesView expenses={expenses} currency={currency} myId={myId} />
          ) : tab === "balances" ? (
            <BalancesView debts={debts} balances={balances} currency={currency} myId={myId} />
          ) : tab === "charts" ? (
            expenses.length === 0 ? (
              <Card>
                <Empty emoji="📊" title="No data to chart yet" subtitle="Add a few expenses to see charts." />
              </Card>
            ) : (
              <View style={{ gap: 12 }}>
                <Card style={{ padding: 16 }}>
                  <SectionTitle>Spending by category</SectionTitle>
                  <CategoryDonut expenses={expenses} currency={currency} />
                </Card>
                <Card style={{ padding: 16 }}>
                  <SectionTitle>Who paid the most</SectionTitle>
                  <PaidByBars expenses={expenses} currency={currency} />
                </Card>
                <Card style={{ padding: 16 }}>
                  <SectionTitle>Net balances</SectionTitle>
                  <BalanceBars balances={balances} currency={currency} />
                </Card>
              </View>
            )
          ) : tab === "activity" ? (
            <ActivityView settlements={settlements} currency={currency} myId={myId} onRespond={respondSettlement} />
          ) : (
            <InfoView
              group={group}
              stats={stats}
              currency={currency}
              elevated={!!elevated}
              onChangeRole={changeRole}
            />
          )}
          </Animated.View>
        </GestureDetector>

        {group && (
          <Pressable onPress={confirmDelete} style={{ alignSelf: "center", marginTop: 28 }}>
            <Text style={{ color: group.role === "owner" ? theme.colors.red : theme.colors.textFaint }}>
              {group.role === "owner" ? "Delete group" : "Leave group"}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={() => nav.navigate("ExpenseForm", { groupId })}>
        <LinearGradient colors={theme.gradients.primary} style={styles.fabGrad}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>＋ Add</Text>
        </LinearGradient>
      </Pressable>

      {group && (
        <InviteModal
          visible={showInvite}
          onClose={() => setShowInvite(false)}
          groupId={group.id}
          groupName={group.name}
        />
      )}
      {group && (
        <MembersSheet
          visible={showMembers}
          onClose={() => setShowMembers(false)}
          members={group.members}
          myId={myId}
        />
      )}
      {group && (
        <EditGroupSheet
          visible={showEdit}
          onClose={() => setShowEdit(false)}
          group={group}
          onSaved={() => load()}
        />
      )}
      <ExportSheet
        visible={showExport}
        onClose={() => setShowExport(false)}
        scope="group"
        group={group}
        expenses={expenses}
        myId={myId}
      />
    </View>
  );
}

// A compact search box used inside the paginated tabs.
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
    <View style={styles.searchWrap}>
      <Text style={styles.searchIcon}>🔍</Text>
      <Input
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        style={styles.searchInput}
        autoCapitalize="none"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange("")} hitSlop={8} style={styles.searchClear}>
          <Text style={{ color: theme.colors.textFaint, fontSize: 16 }}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

// Previous / next pager shown under a paginated list.
function Pager({
  page,
  pages,
  onPrev,
  onNext,
}: {
  page: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (pages <= 1) return null;
  return (
    <View style={styles.pager}>
      <Pressable onPress={onPrev} disabled={page === 0} style={[styles.pagerBtn, page === 0 && styles.pagerDisabled]}>
        <Text style={styles.pagerTxt}>‹ Prev</Text>
      </Pressable>
      <Text style={styles.pagerInfo}>
        {page + 1} / {pages}
      </Text>
      <Pressable onPress={onNext} disabled={page >= pages - 1} style={[styles.pagerBtn, page >= pages - 1 && styles.pagerDisabled]}>
        <Text style={styles.pagerTxt}>Next ›</Text>
      </Pressable>
    </View>
  );
}

// Expenses tab: searchable + paginated (max PAGE_SIZE rows per page).
function ExpensesView({
  expenses,
  currency,
  myId,
}: {
  expenses: Expense[];
  currency: string;
  myId: string;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return expenses;
    return expenses.filter(
      (e) =>
        e.title.toLowerCase().includes(t) ||
        e.category.toLowerCase().includes(t) ||
        (e.notes ?? "").toLowerCase().includes(t) ||
        e.paidBy.name.toLowerCase().includes(t)
    );
  }, [expenses, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (expenses.length === 0) {
    return (
      <Card>
        <Empty emoji="🧾" title="No expenses yet" subtitle="Tap Add to log your first shared expense." />
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <SearchField value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Search expenses…" />
      {filtered.length === 0 ? (
        <Card>
          <Empty emoji="🔍" title="No matches" subtitle="Try a different search." />
        </Card>
      ) : (
        <Card style={{ padding: 6 }}>
          {slice.map((e) => {
            const cat = categoryMeta(e.category);
            const myShare = e.shares.find((s) => s.userId === myId)?.amount ?? 0;
            const net = (e.paidBy.id === myId ? e.amount : 0) - myShare;
            return (
              <View key={e.id} style={styles.expRow}>
                <View style={[styles.expIcon, { backgroundColor: cat.color + "26" }]}>
                  <Text style={{ fontSize: 18 }}>{cat.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expTitle} numberOfLines={1}>
                    {e.title} {e.hasThumbnail ? "📎" : ""}
                  </Text>
                  <Text style={styles.expSub} numberOfLines={1}>
                    {e.paidBy.id === myId ? "You" : e.paidBy.name} paid {formatMoney(currency, e.amount)} · {fmtDay(e.date)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {Math.abs(net) < 0.01 ? (
                    <Text style={styles.expNeutral}>—</Text>
                  ) : (
                    <>
                      <Text style={[styles.expTag, { color: net > 0 ? theme.colors.green : theme.colors.red }]}>
                        {net > 0 ? "you lent" : "you borrowed"}
                      </Text>
                      <Text style={[styles.expAmt, { color: net > 0 ? theme.colors.green : theme.colors.red }]}>
                        {formatMoney(currency, Math.abs(net))}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </Card>
      )}
      <Pager
        page={safePage}
        pages={pages}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(pages - 1, p + 1))}
      />
    </View>
  );
}

function BalancesView({
  debts,
  balances,
  currency,
  myId,
}: {
  debts: Debt[];
  balances: Balance[];
  currency: string;
  myId: string;
}) {
  const active = balances.filter((b) => Math.abs(b.net) > 0.01).sort((a, b) => b.net - a.net);
  return (
    <View style={{ gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <SectionTitle>Who owes whom</SectionTitle>
        {debts.length === 0 ? (
          <Text style={{ color: theme.colors.textDim, textAlign: "center", paddingVertical: 12 }}>
            Everyone's settled up 🎉
          </Text>
        ) : (
          <View style={{ gap: 8 }}>
            {debts.map((d, i) => (
              <View key={i} style={styles.debtRow}>
                <Avatar name={d.fromName} size={28} />
                <Text style={[styles.debtName, d.fromId === myId && { color: theme.colors.red }]}>
                  {d.fromId === myId ? "You" : d.fromName}
                </Text>
                <Text style={{ color: theme.colors.textFaint }}>→</Text>
                <Avatar name={d.toName} size={28} />
                <Text style={[styles.debtName, d.toId === myId && { color: theme.colors.green }]}>
                  {d.toId === myId ? "You" : d.toName}
                </Text>
                <Text style={styles.debtAmt}>{formatMoney(currency, d.amount)}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>
      <Card style={{ padding: 16 }}>
        <SectionTitle>Member balances</SectionTitle>
        {active.length === 0 ? (
          <Text style={{ color: theme.colors.textDim, textAlign: "center", paddingVertical: 8 }}>
            No outstanding balances.
          </Text>
        ) : (
          active.map((b) => (
            <View key={b.id} style={styles.balRow}>
              <Avatar name={b.name} uri={b.avatar} size={30} />
              <Text style={{ color: theme.colors.textDim, flex: 1 }}>{b.id === myId ? "You" : b.name}</Text>
              <Text style={{ color: b.net >= 0 ? theme.colors.green : theme.colors.red, fontWeight: "800" }}>
                {b.net >= 0 ? "+" : "−"}
                {formatMoney(currency, Math.abs(b.net))}
              </Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Activity tab: browse settlements by month (‹ / ›) with a search bar and
// paginated results — matches the web ActivityTab.
function ActivityView({
  settlements,
  currency,
  myId,
  onRespond,
}: {
  settlements: Settlement[];
  currency: string;
  myId: string;
  onRespond: (s: Settlement, action: "approve" | "decline") => void;
}) {
  // Start on the month of the most recent settlement (or today).
  const initial = useMemo(() => {
    const d = settlements[0] ? new Date(settlements[0].createdAt) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }, [settlements]);
  const [ym, setYm] = useState(initial);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const searching = q.trim().length > 0;

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return settlements.filter((s) => {
      if (t) {
        const hit =
          s.from.name.toLowerCase().includes(t) ||
          s.to.name.toLowerCase().includes(t) ||
          s.status.toLowerCase().includes(t) ||
          (s.note ?? "").toLowerCase().includes(t);
        if (!hit) return false;
        return true; // search spans every month
      }
      const d = new Date(s.createdAt);
      return d.getFullYear() === ym.y && d.getMonth() === ym.m;
    });
  }, [settlements, q, ym]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function shiftMonth(delta: number) {
    setYm((cur) => {
      const d = new Date(cur.y, cur.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
    setPage(0);
  }

  const color: Record<string, string> = {
    pending: theme.colors.amber,
    approved: theme.colors.green,
    declined: theme.colors.red,
  };

  if (settlements.length === 0) {
    return (
      <Card>
        <Empty emoji="💸" title="No payments yet" subtitle="Settlements show here, pending confirmation." />
      </Card>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <SearchField value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Search payments…" />

      {!searching && (
        <View style={styles.monthNav}>
          <Pressable onPress={() => shiftMonth(-1)} style={styles.monthBtn} hitSlop={8}>
            <Text style={styles.monthArrow}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>
            {MONTHS[ym.m]} {ym.y}
          </Text>
          <Pressable onPress={() => shiftMonth(1)} style={styles.monthBtn} hitSlop={8}>
            <Text style={styles.monthArrow}>›</Text>
          </Pressable>
        </View>
      )}

      {filtered.length === 0 ? (
        <Card>
          <Empty
            emoji={searching ? "🔍" : "🗓️"}
            title={searching ? "No matches" : "No payments this month"}
            subtitle={searching ? "Try a different search." : "Use ‹ › to browse other months."}
          />
        </Card>
      ) : (
        <Card style={{ padding: 6 }}>
          {slice.map((s) => {
            const canAct = s.status === "pending" && s.to.id === myId;
            return (
              <View key={s.id} style={styles.expRow}>
                <View style={[styles.expIcon, { backgroundColor: "rgba(255,138,61,0.15)" }]}>
                  <Text style={{ fontSize: 18 }}>💸</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expTitle} numberOfLines={1}>
                    {s.from.id === myId ? "You" : s.from.name} → {s.to.id === myId ? "you" : s.to.name}{" "}
                    {formatMoney(currency, s.amount)}
                  </Text>
                  <Text style={styles.expSub}>
                    {fmtDay(s.createdAt)} · <Text style={{ color: color[s.status] }}>{s.status}</Text>
                  </Text>
                </View>
                {canAct && (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable style={[styles.iconBtn, styles.approve]} onPress={() => onRespond(s, "approve")}>
                      <Text style={styles.iconTxt}>✓</Text>
                    </Pressable>
                    <Pressable style={styles.iconBtn} onPress={() => onRespond(s, "decline")}>
                      <Text style={styles.iconTxt}>✕</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      )}
      <Pager
        page={safePage}
        pages={pages}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(pages - 1, p + 1))}
      />
    </View>
  );
}

// Info tab: group details + basic metrics (everyone) and advanced insights
// (owner & moderators), plus role management — the mobile InfoTab.
function InfoView({
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
  onChangeRole: (member: PublicUser, role: Exclude<Role, "owner">) => void;
}) {
  const isOwner = group.role === "owner";
  const basic = stats?.basic;
  const advanced = stats?.advanced;
  const created = new Date(group.createdAt);
  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <SectionTitle>About this group</SectionTitle>
        <Text style={{ color: theme.colors.textDim }}>
          Created on{" "}
          <Text style={{ color: "#fff", fontWeight: "700" }}>
            {created.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
          </Text>
          {group.createdBy ? (
            <Text>
              {" "}by <Text style={{ color: "#fff", fontWeight: "700" }}>{group.createdBy.name}</Text>
            </Text>
          ) : null}
          .
        </Text>
      </Card>

      {/* Basic metrics — everyone */}
      <View style={styles.metricGrid}>
        <Metric label="Total spent" value={basic ? formatMoney(currency, basic.totalSpent) : "—"} sub={basic ? `${basic.expenseCount} ${basic.expenseCount === 1 ? "expense" : "expenses"}` : undefined} />
        <Metric label="Members" value={basic ? String(basic.memberCount) : "—"} />
        <Metric label="You paid" value={basic ? formatMoney(currency, basic.myPaid) : "—"} sub={basic ? `share ${formatMoney(currency, basic.myShare)}` : undefined} />
        <Metric label="Settled" value={basic ? String(basic.settledCount) : "—"} sub={basic && basic.pendingSettlements > 0 ? `${basic.pendingSettlements} pending` : undefined} />
        <Metric label="First expense" value={fmt(basic?.firstExpenseAt)} />
        <Metric label="Last activity" value={fmt(basic?.lastActivityAt)} />
      </View>

      {/* Advanced insights — owner & mods */}
      {elevated && advanced && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingTop: 4 }}>
            <SectionTitle>Advanced insights</SectionTitle>
            <View style={[styles.tag, { backgroundColor: theme.colors.primary2 + "26", marginBottom: 10 }]}>
              <Text style={[styles.tagTxt, { color: theme.colors.primary2 }]}>owner & mods</Text>
            </View>
          </View>
          <View style={styles.metricGrid}>
            <Metric label="Avg expense" value={formatMoney(currency, advanced.avgExpense)} />
            <Metric label="Largest" value={formatMoney(currency, advanced.largestExpense)} />
            <Metric label="Active days" value={String(advanced.activeDays)} />
            <Metric label="Settled volume" value={formatMoney(currency, advanced.settlementVolume)} />
          </View>

          {advanced.topSpender && (
            <Card style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={styles.crown}>
                <Text style={{ fontSize: 20 }}>👑</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.metricLabel}>Top spender</Text>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{advanced.topSpender.name}</Text>
              </View>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
                {formatMoney(currency, advanced.topSpender.amount)}
              </Text>
            </Card>
          )}

          <Card style={{ padding: 16 }}>
            <SectionTitle>Per-member breakdown</SectionTitle>
            {advanced.perMember.map((m) => (
              <View key={m.id} style={styles.pmRow}>
                <Avatar name={m.name} uri={m.avatar} size={30} />
                <Text style={{ color: theme.colors.textDim, flex: 1 }} numberOfLines={1}>
                  {m.id === group.myUserId ? "You" : m.name}
                </Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: theme.colors.textFaint, fontSize: 11 }}>paid {formatMoney(currency, m.paid)}</Text>
                  <Text style={{ color: m.net >= 0 ? theme.colors.green : theme.colors.red, fontWeight: "700", fontSize: 12 }}>
                    net {m.net >= 0 ? "+" : "−"}{formatMoney(currency, Math.abs(m.net))}
                  </Text>
                </View>
              </View>
            ))}
          </Card>

          {advanced.categories.length > 0 && (
            <Card style={{ padding: 16 }}>
              <SectionTitle>By category</SectionTitle>
              {advanced.categories.map((c) => {
                const meta = categoryMeta(c.name);
                return (
                  <View key={c.name} style={styles.pmRow}>
                    <View style={[styles.catIcon, { backgroundColor: meta.color + "26" }]}>
                      <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
                    </View>
                    <Text style={{ color: theme.colors.textDim, flex: 1 }} numberOfLines={1}>{c.name}</Text>
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{formatMoney(currency, c.amount)}</Text>
                  </View>
                );
              })}
            </Card>
          )}
        </>
      )}

      {/* Role management — owner only, promote/demote non-owners */}
      {isOwner && (
        <Card style={{ padding: 16 }}>
          <SectionTitle>Manage roles</SectionTitle>
          {group.members
            .filter((m) => m.role !== "owner")
            .map((m) => (
              <View key={m.id} style={styles.pmRow}>
                <Avatar name={m.name} uri={m.avatar} size={30} />
                <Text style={{ color: "#fff", flex: 1, fontWeight: "600" }} numberOfLines={1}>{m.name}</Text>
                {m.role === "moderator" ? (
                  <Pressable onPress={() => onChangeRole(m, "member")} style={styles.roleBtn}>
                    <Text style={styles.roleBtnTxt}>Demote</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => onChangeRole(m, "moderator")} style={[styles.roleBtn, styles.roleBtnPrimary]}>
                    <Text style={[styles.roleBtnTxt, { color: "#fff" }]}>Make mod</Text>
                  </Pressable>
                )}
              </View>
            ))}
          {group.members.filter((m) => m.role !== "owner").length === 0 && (
            <Text style={{ color: theme.colors.textFaint, paddingVertical: 8 }}>
              Invite people to assign moderators.
            </Text>
          )}
        </Card>
      )}
    </View>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card style={{ padding: 14, width: "48%" }}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.metricSub} numberOfLines={1}>{sub}</Text> : null}
    </Card>
  );
}

function InviteModal({
  visible,
  onClose,
  groupId,
  groupName,
}: {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  groupName?: string;
}) {
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [pending, setPending] = useState<{ id: string; invitee: PublicUser }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // A shareable nudge — there's no public join link (invites are accepted
  // in-app), so this points friends to sign in and check their invites.
  const inviteMessage = `Hey! Join me on Split+${
    groupName ? ` for "${groupName}"` : ""
  } so we can split our expenses. Open ${APP_URL}, sign in with your name, and accept the invite from your home screen. 💸`;

  useFocusEffect(
    useCallback(() => {
      if (!visible) return;
      api.groupInvites(groupId).then((r) => setPending(r.invites)).catch(() => {});
    }, [visible, groupId])
  );

  // Debounced user search (min 3 chars).
  React.useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.searchUsers(query.trim()).then((r) => setResults(r.users)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function invite(u?: PublicUser) {
    const name = u?.name ?? query.trim();
    if (!name) return error("Enter a name");
    setBusy(name);
    try {
      const { invite } = await api.sendInvite(groupId, name);
      setPending((p) => [{ id: invite.id, invitee: invite.invitee }, ...p]);
      setQuery("");
      setResults([]);
      success(`Invited ${invite.invitee.name}`);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't send invite");
    } finally {
      setBusy(null);
    }
  }

  async function shareWhatsApp() {
    const wa = `whatsapp://send?text=${encodeURIComponent(inviteMessage)}`;
    const web = `https://wa.me/?text=${encodeURIComponent(inviteMessage)}`;
    try {
      const canWa = await Linking.canOpenURL(wa);
      await Linking.openURL(canWa ? wa : web);
    } catch {
      error("Couldn't open WhatsApp");
    }
  }

  async function shareSystem() {
    try {
      await Share.share({ message: inviteMessage });
    } catch {
      /* user cancelled */
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20, maxHeight: "88%" }]}>
          <Text style={styles.sheetTitle}>Invite people</Text>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Label>Find someone by name</Label>
            <Input value={query} onChangeText={setQuery} placeholder="Type a name…" autoCapitalize="words" />
            <Text style={{ color: theme.colors.textFaint, fontSize: 12, marginTop: 6 }}>
              They must have logged in to Split+ at least once.
            </Text>

            {results.length > 0 && (
              <View style={{ gap: 8, marginTop: 12 }}>
                {results.map((u) => (
                  <View key={u.id} style={styles.inviteRow}>
                    <Avatar name={u.name} uri={u.avatar} size={34} />
                    <Text style={{ color: "#fff", fontWeight: "700", flex: 1 }} numberOfLines={1}>{u.name}</Text>
                    <Button
                      title="Invite"
                      onPress={() => invite(u)}
                      loading={busy === u.name}
                      style={{ paddingVertical: 8, paddingHorizontal: 14 }}
                    />
                  </View>
                ))}
              </View>
            )}
            {query.trim().length >= 3 && results.length === 0 && (
              <Text style={{ color: theme.colors.textFaint, textAlign: "center", marginTop: 12 }}>
                No one found. They need to log in once before you can invite them.
              </Text>
            )}

            <View style={styles.shareBox}>
              <Text style={styles.shareTitle}>Or share an invite</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={shareWhatsApp} style={[styles.shareBtn, { backgroundColor: "#25D366" }]}>
                  <Text style={{ color: "#000", fontWeight: "800" }}>WhatsApp</Text>
                </Pressable>
                <Pressable onPress={shareSystem} style={[styles.shareBtn, styles.shareGhost]}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Share…</Text>
                </Pressable>
              </View>
            </View>

            {pending.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.shareTitle}>Pending invites</Text>
                <View style={{ gap: 6 }}>
                  {pending.map((p) => (
                    <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
                      <Avatar name={p.invitee.name} uri={p.invitee.avatar} size={28} />
                      <Text style={{ color: theme.colors.textDim, flex: 1 }} numberOfLines={1}>{p.invitee.name}</Text>
                      <Text style={{ color: theme.colors.amber, fontSize: 12 }}>Waiting</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  coverFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  coverFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 120 },
  coverTop: { position: "absolute", left: 12, right: 12, flexDirection: "row", justifyContent: "space-between" },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  roundTxt: { color: "#fff", fontSize: 28, marginTop: -4 },
  invite: { backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  coverTitle: { position: "absolute", left: 16, right: 16, bottom: 14 },
  title: { color: "#fff", fontSize: 26, fontWeight: "900" },
  members: { color: theme.colors.textDim, marginTop: 4 },
  bannerLabel: { color: theme.colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  bannerVal: { fontWeight: "800", fontSize: 18, marginTop: 2 },
  tabs: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 16, padding: 4, marginTop: 14 },
  tab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 12 },
  tabActive: { backgroundColor: "rgba(255,255,255,0.15)" },
  tabText: { color: theme.colors.textFaint, fontWeight: "700", fontSize: 13 },
  expRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10 },
  expIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  expTitle: { color: "#fff", fontWeight: "700", fontSize: 15 },
  expSub: { color: theme.colors.textFaint, fontSize: 12, marginTop: 2 },
  expTag: { fontSize: 11 },
  expAmt: { fontWeight: "800", fontSize: 15 },
  expNeutral: { color: theme.colors.textFaint },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  approve: { backgroundColor: "rgba(56,217,169,0.25)" },
  iconTxt: { color: "#fff", fontWeight: "800" },
  debtRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  debtName: { color: "#fff", fontWeight: "700" },
  debtAmt: { marginLeft: "auto", color: "#fff", fontWeight: "800" },
  balRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  fab: { position: "absolute", right: 20 },
  fabGrad: { height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 16 },
  // Search + pagination
  searchWrap: { flexDirection: "row", alignItems: "center" },
  searchIcon: { position: "absolute", left: 14, zIndex: 1, fontSize: 14 },
  searchInput: { flex: 1, paddingLeft: 40 },
  searchClear: { position: "absolute", right: 12 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 4 },
  pagerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.border },
  pagerDisabled: { opacity: 0.35 },
  pagerTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  pagerInfo: { color: theme.colors.textDim, fontWeight: "700", fontSize: 13 },
  // Month navigator
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, paddingHorizontal: 6, paddingVertical: 6, borderWidth: 1, borderColor: theme.colors.border },
  monthBtn: { width: 40, height: 36, alignItems: "center", justifyContent: "center" },
  monthArrow: { color: "#fff", fontSize: 24, marginTop: -4 },
  monthLabel: { color: "#fff", fontWeight: "800", fontSize: 15 },
  // Info metrics
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricLabel: { color: theme.colors.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  metricValue: { color: "#fff", fontWeight: "800", fontSize: 17, marginTop: 4 },
  metricSub: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  tagTxt: { fontWeight: "800", fontSize: 11 },
  crown: { width: 44, height: 44, borderRadius: 16, backgroundColor: theme.colors.amber + "26", alignItems: "center", justifyContent: "center" },
  pmRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7 },
  catIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  roleBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.border },
  roleBtnPrimary: { backgroundColor: theme.colors.primary + "33", borderColor: theme.colors.primary },
  roleBtnTxt: { color: theme.colors.textDim, fontWeight: "700", fontSize: 12 },
  // Invite modal
  inviteRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border },
  shareBox: { marginTop: 16, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: theme.colors.border },
  shareTitle: { color: theme.colors.textFaint, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  shareBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 14 },
  shareGhost: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.border },
});
