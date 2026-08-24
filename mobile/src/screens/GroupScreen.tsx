import React, { useCallback, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Avatar, Button, Card, Empty, Input, Label, SectionTitle } from "../components/ui";
import { ShimmerText, SkeletonRows } from "../components/Shimmer";
import { BalanceBars, CategoryDonut, PaidByBars } from "../components/charts";
import { api, ApiError } from "../lib/api";
import { formatMoney } from "../shared/currency";
import { categoryMeta } from "../shared/categories";
import { fmtDay } from "../lib/utils";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { RootStackParamList } from "../navigation";
import type { Balance, Debt, Expense, GroupDetail, Settlement } from "../shared/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "Group">;
type Rt = RouteProp<RootStackParamList, "Group">;
type Tab = "expenses" | "balances" | "charts" | "activity";

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
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("expenses");
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, e, b, s] = await Promise.all([
        api.getGroup(groupId),
        api.listExpenses(groupId),
        api.getBalances(groupId),
        api.listSettlements(groupId),
      ]);
      setGroup(g.group);
      setExpenses(e.expenses);
      setBalances(b.balances);
      setDebts(b.debts);
      setMyNet(b.myNet);
      setSettlements(s.settlements);
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
          <Pressable style={styles.invite} onPress={() => setShowInvite(true)}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>+ Invite</Text>
          </Pressable>
        </View>
        <View style={styles.coverTitle}>
          <Text style={styles.title} numberOfLines={1}>
            {group ? `${group.emoji ?? ""} ${group.name}` : "…"}
          </Text>
          {group && (
            <Text style={styles.members}>
              {group.members.length} {group.members.length === 1 ? "member" : "members"}
            </Text>
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
          {(["expenses", "balances", "charts", "activity"] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
              <Text style={[styles.tabText, tab === t && { color: "#fff" }]}>
                {t[0].toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: 14 }}>
          {loading ? (
            <Card style={{ padding: 8 }}>
              <SkeletonRows count={5} />
            </Card>
          ) : !group ? null : tab === "expenses" ? (
            expenses.length === 0 ? (
              <Card>
                <Empty emoji="🧾" title="No expenses yet" subtitle="Tap Add to log your first shared expense." />
              </Card>
            ) : (
              <Card style={{ padding: 6 }}>
                {expenses.map((e) => {
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
            )
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
          ) : (
            <ActivityView settlements={settlements} currency={currency} myId={myId} onRespond={respondSettlement} />
          )}
        </View>

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

      {group && <InviteModal visible={showInvite} onClose={() => setShowInvite(false)} groupId={group.id} />}
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
  if (settlements.length === 0) {
    return (
      <Card>
        <Empty emoji="💸" title="No payments yet" subtitle="Settlements show here, pending confirmation." />
      </Card>
    );
  }
  const color: Record<string, string> = {
    pending: theme.colors.amber,
    approved: theme.colors.green,
    declined: theme.colors.red,
  };
  return (
    <Card style={{ padding: 6 }}>
      {settlements.map((s) => {
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
  );
}

function InviteModal({ visible, onClose, groupId }: { visible: boolean; onClose: () => void; groupId: string }) {
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!name.trim()) return error("Enter a name");
    setBusy(true);
    try {
      const { invite } = await api.sendInvite(groupId, name.trim());
      success(`Invited ${invite.invitee.name}`);
      setName("");
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't send invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.sheetTitle}>Invite someone</Text>
          <Label>Their name on Split+</Label>
          <Input value={name} onChangeText={setName} placeholder="Type their exact name…" autoCapitalize="words" />
          <Text style={{ color: theme.colors.textFaint, fontSize: 12, marginTop: 8 }}>
            They must have logged in to Split+ at least once.
          </Text>
          <Button title="Send invite" onPress={send} loading={busy} style={{ marginTop: 18 }} />
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
});
