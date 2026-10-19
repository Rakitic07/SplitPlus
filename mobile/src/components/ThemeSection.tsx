import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Label } from "./ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { AppTheme } from "../shared/types";

const THEMES: { value: AppTheme; label: string }[] = [
  { value: "glass", label: "Liquid glass" },
  { value: "neumorph", label: "Neumorph" },
];

// Previews use fixed colours so each looks right whichever theme is running.
function Preview({ value }: { value: AppTheme }) {
  if (value === "neumorph") {
    return (
      <View style={[styles.preview, { backgroundColor: "#262a30" }]}>
        <View style={styles.nmKnob} />
        <View style={styles.nmWell} />
      </View>
    );
  }
  return (
    <LinearGradient colors={["#3a2410", "#0a0805"]} style={styles.preview}>
      <View style={styles.glassPane} />
      <LinearGradient colors={theme.gradients.primary} style={styles.dot} />
    </LinearGradient>
  );
}

// Theme picker (mirrors the web ThemePicker). Native styles are built at
// launch, so a new choice applies the next time the app is opened.
export function ThemeSection() {
  const { user, setUser } = useAuth();
  const { error } = useToast();
  const [saving, setSaving] = useState<AppTheme | null>(null);
  const chosen = user?.theme ?? "glass";
  const pending = chosen !== theme.mode;

  async function choose(next: AppTheme) {
    if (next === chosen || saving) return;
    setSaving(next);
    try {
      const { user: updated } = await api.updateSettings({ theme: next });
      setUser(updated);
      if (next !== theme.mode) {
        Alert.alert(
          "Theme saved",
          "Close Split+ completely (swipe it away from recent apps) and open it again to see the new look."
        );
      }
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't change the theme");
    } finally {
      setSaving(null);
    }
  }

  return (
    <View>
      <Label>Theme</Label>
      <View style={styles.row}>
        {THEMES.map((t) => {
          const active = chosen === t.value;
          return (
            <Pressable
              key={t.value}
              onPress={() => choose(t.value)}
              disabled={!!saving}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              style={[styles.option, active && styles.optionActive]}
            >
              <Preview value={t.value} />
              <View style={styles.labelRow}>
                <Text style={styles.label}>{t.label}</Text>
                {saving === t.value ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : active ? (
                  <Text style={{ color: theme.colors.primary2, fontWeight: "900" }}>✓</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {pending && <Text style={styles.hint}>Reopen the app to apply the new theme.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  option: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    padding: 8,
  },
  optionActive: { borderColor: theme.colors.primary },
  preview: {
    height: 64,
    borderRadius: 12,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  nmKnob: {
    width: 44,
    height: 30,
    borderRadius: 10,
    backgroundColor: "#2b2f36",
    borderWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    borderLeftColor: "rgba(255,255,255,0.09)",
    borderBottomColor: "rgba(0,0,0,0.4)",
    borderRightColor: "rgba(0,0,0,0.3)",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 3, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  nmWell: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#1f2227",
    borderWidth: 1,
    borderTopColor: "rgba(0,0,0,0.5)",
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderLeftColor: "rgba(0,0,0,0.4)",
    borderRightColor: "rgba(255,255,255,0.06)",
  },
  glassPane: {
    width: 44,
    height: 30,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  dot: { width: 20, height: 20, borderRadius: 10 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingHorizontal: 4 },
  label: { color: "#fff", fontWeight: "700", fontSize: 14 },
  hint: { color: theme.colors.primary2, fontSize: 12, marginTop: 8 },
});
