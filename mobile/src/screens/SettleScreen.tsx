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
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { RootStackParamList } from "../navigation";
import type { Debt, GroupDetail } from "../shared/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "Settle">;
type Rt = RouteProp<RootStackParamList, "Settle">;

export function SettleScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Rt>().params;
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.getGroup(groupId), api.getBalances(groupId)])
      .then(([g, b]) => {
        setGroup(g.group);
        setDebts(b.debts);
        const mine = b.debts.filter((d) => d.fromId === g.group.myUserId);
        const others = g.group.members.filter((m) => m.id !== g.group.myUserId);
        const initial = mine[0]?.toId ?? others[0]?.id ?? "";
        setToId(initial);
        if (mine[0]) setAmount(String(mine[0].amount));
      })
      .catch(() => {
        error("Couldn't load group");
        nav.goBack();
      });
  }, [groupId]);

  function pickRecipient(id: string) {
    setToId(id);
    const owed = debts.find((d) => d.fromId === group?.myUserId && d.toId === id);
    if (owed) setAmount(String(owed.amount));
  }

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
    if (!toId) return error("Choose who you're paying");
    if (amt <= 0) return error("Enter a valid amount");
    setBusy(true);
    try {
      await api.createSettlement(groupId, { toId, amount: amt, note: note.trim() || undefined, thumbnail: thumb ?? undefined });
      success("Payment recorded — waiting for confirmation");
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
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => nav.goBack()}>
          <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>Cancel</Text>
        </Pressable>
        <Text style={styles.headTitle}>Settle up</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: theme.colors.textDim }}>
          Record a payment you made. It only affects balances once the recipient confirms it.
        </Text>

        <View>
          <Label>You're paying</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {others.map((m) => {
              const owed = debts.find((d) => d.fromId === group?.myUserId && d.toId === m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => pickRecipient(m.id)}
                  style={[styles.payChip, toId === m.id && styles.payChipActive]}
                >
                  <Avatar name={m.name} uri={m.avatar} size={22} />
                  <Text style={{ color: toId === m.id ? "#fff" : theme.colors.textDim }}>
                    {m.name}
                    {owed ? `  (owe ${formatMoney(currency, owed.amount)})` : ""}
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

        <Button title="Record payment" onPress={submit} loading={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  headTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  payChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  payChipActive: { borderColor: "rgba(255,255,255,0.5)", backgroundColor: "rgba(255,255,255,0.15)" },
  attach: { height: 72, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" },
  removeImg: { position: "absolute", top: -8, right: -8, backgroundColor: theme.colors.red, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
