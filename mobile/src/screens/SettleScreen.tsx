import React, { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Avatar, Button, Card, Input, Label } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatMoney } from "../shared/currency";
import { ToastView, useToast } from "../state/toast";
import { theme, inset, raised } from "../theme";
import type { RootStackParamList } from "../navigation";
import type { Debt, GroupDetail } from "../shared/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "Settle">;
type Rt = RouteProp<RootStackParamList, "Settle">;
type Direction = "pay" | "receive";

export function SettleScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Rt>().params;
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [direction, setDirection] = useState<Direction>("pay");
  const [otherId, setOtherId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // What's outstanding with `id` in the given direction (pay: I owe them;
  // receive: they owe me).
  function owedWith(dir: Direction, id: string, ds = debts, meId = group?.myUserId) {
    const d = ds.find((x) =>
      dir === "pay" ? x.fromId === meId && x.toId === id : x.toId === meId && x.fromId === id
    );
    return d?.amount;
  }
  function firstTarget(dir: Direction, ds: Debt[], g: GroupDetail) {
    const d = ds.find((x) => (dir === "pay" ? x.fromId === g.myUserId : x.toId === g.myUserId));
    const others = g.members.filter((m) => m.id !== g.myUserId);
    return (d ? (dir === "pay" ? d.toId : d.fromId) : others[0]?.id) ?? "";
  }

  useEffect(() => {
    Promise.all([api.getGroup(groupId), api.getBalances(groupId)])
      .then(([g, b]) => {
        const me = g.group.myUserId;
        setGroup(g.group);
        setDebts(b.debts);
        const iOwe = b.debts.some((d) => d.fromId === me);
        const owesMe = b.debts.some((d) => d.toId === me);
        const dir: Direction = !iOwe && owesMe ? "receive" : "pay";
        const target = firstTarget(dir, b.debts, g.group);
        setDirection(dir);
        setOtherId(target);
        const v = owedWith(dir, target, b.debts, me);
        if (v) setAmount(String(v));
      })
      .catch(() => {
        error("Couldn't load group");
        nav.goBack();
      });
  }, [groupId]);

  function pickPerson(id: string, dir = direction) {
    setOtherId(id);
    const v = owedWith(dir, id);
    setAmount(v ? String(v) : "");
  }

  function switchDirection(dir: Direction) {
    if (dir === direction || !group) return;
    setDirection(dir);
    pickPerson(owedWith(dir, otherId) !== undefined ? otherId : firstTarget(dir, debts, group), dir);
  }

  const receiving = direction === "receive";

  async function pickProof() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    if (!res.canceled && res.assets[0]?.base64) setThumb(`data:image/jpeg;base64,${res.assets[0].base64}`);
  }

  async function submit() {
    const amt = Number(amount) || 0;
    if (!otherId) return error(receiving ? "Choose who paid you" : "Choose who you're paying");
    if (amt <= 0) return error("Enter a valid amount");
    setBusy(true);
    try {
      await api.createSettlement(groupId, {
        toId: otherId,
        direction,
        amount: amt,
        note: note.trim() || undefined,
        thumbnail: thumb ?? undefined,
      });
      success(receiving ? "Payment received — balances updated" : "Payment recorded — waiting for confirmation");
      nav.goBack();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't record payment");
    } finally {
      setBusy(false);
    }
  }

  const currency = group?.currency ?? "INR";
  const others = group?.members.filter((m) => m.id !== group.myUserId) ?? [];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={[styles.head, { paddingTop: Platform.OS === "ios" ? 16 : insets.top + 8 }]}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} accessibilityRole="button">
          <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>Cancel</Text>
        </Pressable>
        <Text style={styles.headTitle}>Settle up</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.tabs}>
          {(
            [
              ["pay", "↗  I paid"],
              ["receive", "↙  I received"],
            ] as const
          ).map(([dir, label]) => (
            <Pressable
              key={dir}
              onPress={() => switchDirection(dir)}
              style={[styles.tab, direction === dir && styles.tabActive]}
            >
              <Text style={[styles.tabText, direction === dir && { color: "#fff" }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ color: theme.colors.textDim }}>
          {receiving
            ? "Record money someone paid you. Since you're the one receiving it, balances update right away."
            : "Record a payment you made. It only affects balances once the recipient confirms it."}
        </Text>

        <View>
          <Label>{receiving ? "Who paid you" : "You're paying"}</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {others.map((m) => {
              const owed = owedWith(direction, m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => pickPerson(m.id)}
                  style={[styles.payChip, otherId === m.id && styles.payChipActive]}
                >
                  <Avatar name={m.name} uri={m.avatar} size={22} />
                  <Text style={{ color: otherId === m.id ? "#fff" : theme.colors.textDim }}>
                    {m.name}
                    {owed !== undefined ? `  (${receiving ? "owes you" : "owe"} ${formatMoney(currency, owed)})` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View>
          <Label>Amount ({currency})</Label>
          <Input value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
        </View>

        <View>
          <Label>Note (optional)</Label>
          <Input value={note} onChangeText={setNote} placeholder="UPI ref, cash, etc." />
        </View>

        <View>
          <Label>Payment proof (optional)</Label>
          {thumb ? (
            <View>
              <Image source={{ uri: thumb }} style={{ height: 120, borderRadius: 16 }} resizeMode="cover" />
              <Pressable onPress={() => setThumb(null)} style={styles.removeImg}>
                <Text style={{ color: "#fff" }}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={pickProof} style={styles.attach}>
              <Text style={{ color: theme.colors.textFaint }}>＋ Attach a screenshot</Text>
            </Pressable>
          )}
        </View>

        <Button
          title={!group ? "Loading…" : receiving ? "Record money received" : "Record payment"}
          onPress={submit}
          loading={busy}
          disabled={!group}
        />
      </ScrollView>
      <ToastView iosModalScreen />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  headTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  tabs: { flexDirection: "row", ...inset("rgba(0,0,0,0.25)"), borderRadius: 16, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 12 },
  tabActive: { ...raised("rgba(255,255,255,0.15)") },
  tabText: { color: theme.colors.textFaint, fontWeight: "700" },
  payChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  payChipActive: { borderColor: "rgba(255,255,255,0.5)", ...raised("rgba(255,255,255,0.15)") },
  attach: { height: 72, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", ...raised("rgba(255,255,255,0.05)") },
  removeImg: { position: "absolute", top: -8, right: -8, backgroundColor: theme.colors.red, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
