import React, { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Avatar, Button, Input, Label } from "./ui";
import { api, ApiError, type NameChangeStatus } from "../lib/api";
import { CURRENCIES } from "../shared/currency";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { ReminderFrequency } from "../shared/types";

const FREQ: { value: ReminderFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// User settings: avatar, default currency and settle-up reminders — mirrors the
// web SettingsModal so both platforms stay at feature parity.
export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { user, setUser, logout } = useAuth();
  const { success, error } = useToast();

  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null);
  const [currency, setCurrency] = useState(user?.defaultCurrency ?? "INR");
  const [reminderEnabled, setReminderEnabled] = useState(user?.reminderEnabled ?? false);
  const [reminderFrequency, setReminderFrequency] = useState<ReminderFrequency>(
    user?.reminderFrequency ?? "weekly"
  );
  const [busy, setBusy] = useState(false);

  // Display-name editing (rate-limited to 2 / 30 days server-side).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameChangeStatus | null>(null);

  useEffect(() => {
    if (!visible || !user) return;
    setAvatar(user.avatar ?? null);
    setCurrency(user.defaultCurrency);
    setReminderEnabled(user.reminderEnabled);
    setReminderFrequency(user.reminderFrequency);
    setEditingName(false);
    setNameDraft(user.name);
    api.nameStatus().then(setNameStatus).catch(() => setNameStatus(null));
  }, [visible, user]);

  async function saveName() {
    if (!user) return;
    const next = nameDraft.trim();
    if (!next || next === user.name) {
      setEditingName(false);
      setNameDraft(user.name);
      return;
    }
    setNameBusy(true);
    try {
      const { user: updated, status } = await api.changeName(next);
      setUser(updated);
      setNameStatus(status);
      setEditingName(false);
      success("Name updated");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't change name");
    } finally {
      setNameBusy(false);
    }
  }

  const nameHint = nameStatus
    ? nameStatus.remaining > 0
      ? `${nameStatus.remaining} of ${nameStatus.limit} name changes left in the next ${nameStatus.windowDays} days.`
      : `Limit reached — change it again on ${
          nameStatus.nextChangeAt
            ? new Date(nameStatus.nextChangeAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "later"
        }.`
    : "You can change your name up to twice a month.";

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
      aspect: [1, 1],
    });
    if (!res.canceled && res.assets[0]?.base64) {
      setAvatar(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  }

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      const { user: updated } = await api.updateSettings({
        avatar: avatar ?? "",
        defaultCurrency: currency,
        reminderEnabled,
        reminderFrequency,
      });
      setUser(updated);
      success("Settings saved");
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.title}>Settings</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.avatarRow}>
              <Pressable onPress={pick}>
                <Avatar name={user.name} uri={avatar} size={64} />
                <View style={styles.badge}>
                  <Text style={{ color: "#fff", fontWeight: "800" }}>＋</Text>
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user.name}</Text>
                <View style={{ flexDirection: "row", gap: 14, marginTop: 4 }}>
                  <Pressable onPress={pick}>
                    <Text style={styles.link}>Change photo</Text>
                  </Pressable>
                  {avatar ? (
                    <Pressable onPress={() => setAvatar(null)}>
                      <Text style={[styles.link, { color: theme.colors.red }]}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>

            <View style={{ height: 18 }} />
            <Label>Display name</Label>
            {editingName ? (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Input value={nameDraft} onChangeText={setNameDraft} maxLength={40} placeholder="Your name" autoFocus />
                </View>
                <Button title="Save" onPress={saveName} loading={nameBusy} style={{ paddingHorizontal: 16 }} />
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.nameVal} numberOfLines={1}>{user.name}</Text>
                <Pressable
                  onPress={() => {
                    setNameDraft(user.name);
                    setEditingName(true);
                  }}
                  disabled={nameStatus?.remaining === 0}
                >
                  <Text style={[styles.nameEdit, nameStatus?.remaining === 0 && { opacity: 0.4 }]}>Edit</Text>
                </Pressable>
              </View>
            )}
            <Text style={[styles.hint, { marginTop: 6 }]}>{nameHint}</Text>

            <View style={{ height: 18 }} />
            <Label>Default currency</Label>
            <Text style={styles.hint}>Pre-selected when you create a new group.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 4 }}>
              {CURRENCIES.map((c) => (
                <Pressable
                  key={c.code}
                  onPress={() => setCurrency(c.code)}
                  style={[styles.cur, currency === c.code && styles.curActive]}
                >
                  <Text style={{ color: currency === c.code ? "#fff" : theme.colors.textDim, fontWeight: "700" }}>
                    {c.symbol} {c.code}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={{ height: 18 }} />
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Settle-up reminders</Text>
                <Text style={styles.hint}>Nudge me when I have unsettled balances.</Text>
              </View>
              <Switch
                value={reminderEnabled}
                onValueChange={setReminderEnabled}
                trackColor={{ true: theme.colors.primary, false: "rgba(255,255,255,0.15)" }}
                thumbColor="#fff"
              />
            </View>
            {reminderEnabled && (
              <View style={styles.freqRow}>
                {FREQ.map((f) => (
                  <Pressable
                    key={f.value}
                    onPress={() => setReminderFrequency(f.value)}
                    style={[styles.freq, reminderFrequency === f.value && styles.freqActive]}
                  >
                    <Text style={{ color: reminderFrequency === f.value ? "#fff" : theme.colors.textDim, fontWeight: "700" }}>
                      {f.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Button title="Save changes" onPress={save} loading={busy} style={{ marginTop: 22 }} />
            <Pressable
              onPress={() => {
                onClose();
                logout().then(() => success("Logged out"));
              }}
              style={{ alignSelf: "center", marginTop: 16 }}
            >
              <Text style={{ color: theme.colors.red, fontWeight: "700" }}>Log out</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: "88%" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 16 },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  badge: { position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: theme.colors.bgElevated },
  name: { color: "#fff", fontSize: 18, fontWeight: "800" },
  link: { color: theme.colors.primary2, fontWeight: "700", fontSize: 13 },
  hint: { color: theme.colors.textFaint, fontSize: 12, marginBottom: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: theme.colors.border },
  nameVal: { color: "#fff", fontWeight: "800", fontSize: 15, flex: 1 },
  nameEdit: { color: theme.colors.primary2, fontWeight: "800", fontSize: 13 },
  cur: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" },
  curActive: { backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  toggleTitle: { color: "#fff", fontWeight: "700", fontSize: 15 },
  freqRow: { flexDirection: "row", gap: 6, marginTop: 10, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 14, padding: 4 },
  freq: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  freqActive: { backgroundColor: "rgba(255,255,255,0.15)" },
});
