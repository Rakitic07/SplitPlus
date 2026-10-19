import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Label } from "./ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { theme, inset, raised } from "../theme";
import type { SessionPolicy } from "../shared/types";

const POLICIES: { value: SessionPolicy; label: string; hint: string }[] = [
  {
    value: "6months",
    label: "After 6 months",
    hint: "You'll be signed out if you don't open Split+ for 6 months.",
  },
  {
    value: "never",
    label: "Never",
    hint: "Stay signed in on your devices until you log out yourself.",
  },
];

// "Stay signed in" preference + a kill switch for every session (mirrors the
// web SessionSettings). Saves immediately.
export function SessionSection({ onSignedOut }: { onSignedOut: () => void }) {
  const { user, setUser, logoutAll } = useAuth();
  const { success, error } = useToast();
  const [saving, setSaving] = useState<SessionPolicy | null>(null);

  const policy = user?.sessionPolicy ?? "6months";
  const current = POLICIES.find((p) => p.value === policy) ?? POLICIES[0];

  async function choose(next: SessionPolicy) {
    if (next === policy || saving) return;
    setSaving(next);
    try {
      const { user: updated } = await api.updateSettings({ sessionPolicy: next });
      setUser(updated);
      success(next === "never" ? "You'll stay signed in" : "Auto sign-out set to 6 months");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't update that setting");
    } finally {
      setSaving(null);
    }
  }

  function confirmLogoutAll() {
    Alert.alert(
      "Log out of all devices?",
      "This signs you out everywhere, including this phone. You'll need your passphrase to log back in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out all",
          style: "destructive",
          onPress: async () => {
            try {
              await logoutAll();
              onSignedOut();
              success("Logged out of all devices");
            } catch (err) {
              error(err instanceof ApiError ? err.message : "Couldn't log out everywhere");
            }
          },
        },
      ]
    );
  }

  return (
    <View>
      <Label>Automatically sign me out</Label>
      <Text style={styles.hint}>{current.hint}</Text>
      <View style={styles.tabs}>
        {POLICIES.map((p) => (
          <Pressable
            key={p.value}
            onPress={() => choose(p.value)}
            disabled={!!saving}
            style={[styles.tab, policy === p.value && styles.tabActive]}
          >
            {saving === p.value ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: policy === p.value ? "#fff" : theme.colors.textDim, fontWeight: "700" }}>
                {p.label}
              </Text>
            )}
          </Pressable>
        ))}
      </View>

      <Pressable onPress={confirmLogoutAll} style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Log out of all devices</Text>
          <Text style={styles.hint}>Lost a phone or used a shared device? End every session.</Text>
        </View>
        <Text style={{ color: theme.colors.red, fontWeight: "800" }}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: theme.colors.textFaint, fontSize: 12, marginBottom: 6 },
  tabs: { flexDirection: "row", gap: 6, ...inset("rgba(0,0,0,0.25)"), borderRadius: 14, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, minHeight: 40, justifyContent: "center" },
  tabActive: { ...raised("rgba(255,255,255,0.15)") },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowTitle: { color: theme.colors.red, fontWeight: "700", fontSize: 15, marginBottom: 2 },
});
