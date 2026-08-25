import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { ImagePreview } from "../components/ImagePreview";
import { api, ApiError, type ShareInputDto } from "../lib/api";
import { CATEGORIES } from "../shared/categories";
import { formatMoney } from "../shared/currency";
import { computeShares, validateSplit, type SplitMode } from "../shared/split";
import { todayISO } from "../lib/utils";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { RootStackParamList } from "../navigation";
import type { Expense, GroupDetail } from "../shared/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "ExpenseForm">;
type Rt = RouteProp<RootStackParamList, "ExpenseForm">;
type ShareState = Record<string, { included: boolean; value: string }>;

const MODES: { key: SplitMode; label: string }[] = [
  { key: "equal", label: "Equally" },
  { key: "exact", label: "Exact" },
  { key: "percent", label: "Percent" },
  { key: "shares", label: "Shares" },
];

export function ExpenseFormScreen() {
  const nav = useNavigation<Nav>();
  const { groupId, expenseId } = useRoute<Rt>().params;
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].name);
  const [date, setDate] = useState(todayISO());
  const [paidById, setPaidById] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<SplitMode>("equal");
  const [shares, setShares] = useState<ShareState>({});
  const [thumb, setThumb] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Load the group and, when editing, the full expense (incl. its receipt)
        // in parallel, then prefill the form from the existing expense.
        const [{ group: g }, exp] = await Promise.all([
          api.getGroup(groupId),
          expenseId ? api.getExpense(groupId, expenseId).then((r) => r.expense) : Promise.resolve(null),
        ]);
        setGroup(g);
        if (exp) {
          setEditing(exp);
          setTitle(exp.title);
          setAmount(String(exp.amount));
          setCategory(exp.category);
          setDate(exp.date.slice(0, 10));
          setPaidById(exp.paidBy.id);
          setNotes(exp.notes ?? "");
          setMode(exp.splitMode);
          setThumb(exp.thumbnail ?? null);
          const st: ShareState = {};
          for (const m of g.members) {
            const share = exp.shares.find((s) => s.userId === m.id);
            let value = "";
            if (share) {
              if (exp.splitMode === "exact") value = String(share.amount);
              else if (exp.splitMode === "percent") value = String(Math.round((share.amount / exp.amount) * 100));
              else if (exp.splitMode === "shares") value = String(share.amount);
            }
            st[m.id] = { included: !!share, value };
          }
          setShares(st);
        } else {
          setPaidById(g.myUserId);
          const st: ShareState = {};
          for (const m of g.members) st[m.id] = { included: true, value: "" };
          setShares(st);
        }
      } catch {
        error("Couldn't load expense");
        nav.goBack();
      }
    })();
  }, [groupId, expenseId]);

  const amt = Number(amount) || 0;
  const inputs: ShareInputDto[] = useMemo(
    () =>
      (group?.members ?? []).map((m) => ({
        userId: m.id,
        included: shares[m.id]?.included ?? false,
        value: Number(shares[m.id]?.value) || 0,
      })),
    [group, shares]
  );
  const computed = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of computeShares(amt, mode, inputs)) map.set(c.userId, c.amount);
    return map;
  }, [amt, mode, inputs]);
  const includedCount = inputs.filter((s) => s.included).length;
  const splitError = amt > 0 ? validateSplit(amt, mode, inputs) : null;
  const currency = group?.currency ?? "INR";

  function toggle(id: string) {
    setShares((s) => ({ ...s, [id]: { ...s[id], included: !s[id]?.included } }));
  }
  function setValue(id: string, value: string) {
    setShares((s) => ({ ...s, [id]: { ...s[id], value } }));
  }

  async function pickReceipt() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    if (!res.canceled && res.assets[0]?.base64) setThumb(`data:image/jpeg;base64,${res.assets[0].base64}`);
  }

  async function save() {
    if (!title.trim()) return error("Add a title");
    if (amt <= 0) return error("Enter a valid amount");
    if (includedCount === 0) return error("Select at least one participant");
    if (splitError) return error(splitError);
    setBusy(true);
    const payload = {
      title: title.trim(),
      category,
      amount: amt,
      paidById,
      date,
      notes: notes.trim() || undefined,
      splitMode: mode,
      thumbnail: thumb ?? "",
      shares: inputs,
    };
    try {
      if (editing) {
        await api.updateExpense(groupId, editing.id, payload);
        success("Expense updated");
      } else {
        await api.createExpense(groupId, payload);
        success("Expense added");
      }
      nav.goBack();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (!editing) return;
    Alert.alert("Delete expense", `Remove "${editing.title}"? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteExpense(groupId, editing.id);
            success("Expense deleted");
            nav.goBack();
          } catch (err) {
            error(err instanceof ApiError ? err.message : "Couldn't delete");
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => nav.goBack()}>
          <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>Cancel</Text>
        </Pressable>
        <Text style={styles.headTitle}>{editing ? "Edit expense" : "Add expense"}</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View>
          <Label>What was it for?</Label>
          <Input value={title} onChangeText={setTitle} placeholder="Dinner at Olive" />
        </View>
        <View>
          <Label>Amount ({currency})</Label>
          <Input value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
        </View>

        <View>
          <Label>Category</Label>
          <View style={styles.wrap}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c.name}
                onPress={() => setCategory(c.name)}
                style={[styles.chip, category === c.name && { borderColor: c.color, backgroundColor: c.color + "33" }]}
              >
                <Text style={{ color: category === c.name ? "#fff" : theme.colors.textDim, fontSize: 13 }}>
                  {c.emoji} {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {group && (
          <View>
            <Label>Paid by</Label>
            <View style={styles.wrap}>
              {group.members.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setPaidById(m.id)}
                  style={[styles.payChip, paidById === m.id && styles.payChipActive]}
                >
                  <Avatar name={m.name} uri={m.avatar} size={22} />
                  <Text style={{ color: paidById === m.id ? "#fff" : theme.colors.textDim }}>
                    {m.id === group.myUserId ? "You" : m.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View>
          <Label>How to split</Label>
          <View style={styles.modeRow}>
            {MODES.map((m) => (
              <Pressable
                key={m.key}
                onPress={() => setMode(m.key)}
                style={[styles.mode, mode === m.key && styles.modeActive]}
              >
                <Text style={{ color: mode === m.key ? "#fff" : theme.colors.textFaint, fontWeight: "700", fontSize: 13 }}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {group && (
          <Card style={{ padding: 6 }}>
            <View style={styles.partHead}>
              <Text style={styles.partHeadTxt}>Split between {includedCount}</Text>
              {mode === "equal" && includedCount > 0 && amt > 0 && (
                <Text style={styles.partHeadTxt}>{formatMoney(currency, amt / includedCount)} each</Text>
              )}
            </View>
            {group.members.map((m) => {
              const st = shares[m.id] ?? { included: false, value: "" };
              const owed = computed.get(m.id) ?? 0;
              return (
                <View key={m.id} style={styles.partRow}>
                  <Pressable onPress={() => toggle(m.id)} style={[styles.check, st.included && styles.checkOn]}>
                    {st.included && <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text>}
                  </Pressable>
                  <Avatar name={m.name} uri={m.avatar} size={28} />
                  <Text style={{ color: "#fff", flex: 1 }}>{m.id === group.myUserId ? "You" : m.name}</Text>
                  {st.included && mode !== "equal" && (
                    <Input
                      value={st.value}
                      onChangeText={(v) => setValue(m.id, v)}
                      placeholder={mode === "shares" ? "1" : mode === "percent" ? "%" : "0"}
                      keyboardType="decimal-pad"
                      style={styles.valInput}
                    />
                  )}
                  <Text style={{ color: st.included ? "#fff" : theme.colors.textFaint, fontWeight: "700", width: 74, textAlign: "right" }}>
                    {st.included ? formatMoney(currency, owed) : "—"}
                  </Text>
                </View>
              );
            })}
          </Card>
        )}

        {splitError && amt > 0 && (
          <View style={styles.warn}>
            <Text style={{ color: theme.colors.amber, fontSize: 13 }}>{splitError}</Text>
          </View>
        )}

        <View>
          <Label>Notes (optional)</Label>
          <Input value={notes} onChangeText={setNotes} placeholder="Add a note…" />
        </View>

        <View>
          <Label>Receipt / screenshot</Label>
          {thumb ? (
            <View>
              <Pressable onPress={() => setPreview(true)}>
                <Image source={{ uri: thumb }} style={{ height: 120, borderRadius: 16 }} resizeMode="cover" />
                <View style={styles.tapHint}>
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Tap to preview</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setThumb(null)} style={styles.removeImg}>
                <Text style={{ color: "#fff" }}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={pickReceipt} style={styles.attach}>
              <Text style={{ color: theme.colors.textFaint }}>＋ Attach a receipt</Text>
            </Pressable>
          )}
        </View>

        <Button title={editing ? "Save changes" : "Add expense"} onPress={save} loading={busy} />

        {editing && (
          <Pressable onPress={confirmDelete} style={{ alignSelf: "center", paddingVertical: 8 }}>
            <Text style={{ color: theme.colors.red, fontWeight: "700" }}>Delete expense</Text>
          </Pressable>
        )}
      </ScrollView>

      <ImagePreview visible={preview} src={thumb} onClose={() => setPreview(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  headTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  payChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  payChipActive: { borderColor: "rgba(255,255,255,0.5)", backgroundColor: "rgba(255,255,255,0.15)" },
  modeRow: { flexDirection: "row", gap: 8 },
  mode: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border },
  modeActive: { backgroundColor: "rgba(255,255,255,0.15)", borderColor: "rgba(255,255,255,0.5)" },
  partHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 8 },
  partHeadTxt: { color: theme.colors.textFaint, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  partRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: "rgba(255,138,61,0.5)", borderColor: theme.colors.primary },
  valInput: { width: 74, paddingVertical: 6, paddingHorizontal: 8, textAlign: "right" },
  warn: { backgroundColor: "rgba(255,212,59,0.1)", borderColor: "rgba(255,212,59,0.3)", borderWidth: 1, borderRadius: 12, padding: 10 },
  attach: { height: 72, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" },
  removeImg: { position: "absolute", top: -8, right: -8, backgroundColor: theme.colors.red, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tapHint: { position: "absolute", bottom: 8, right: 8, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
});
