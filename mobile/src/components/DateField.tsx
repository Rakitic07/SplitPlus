import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme, inset, raised } from "../theme";
import { todayISO } from "../lib/utils";

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (iso: string, days: number) => {
  const d = parse(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

/** Day stepper for an expense date (YYYY-MM-DD, local). Future days are blocked. */
export function DateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const today = todayISO();
  const yesterday = shift(today, -1);
  const atToday = value >= today;
  const label =
    value === today
      ? "Today"
      : value === yesterday
        ? "Yesterday"
        : parse(value).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        <Pressable
          onPress={() => onChange(shift(value, -1))}
          style={styles.step}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Text style={styles.stepTxt}>‹</Text>
        </Pressable>
        <Text style={styles.label} accessibilityLiveRegion="polite">
          {label}
        </Text>
        <Pressable
          onPress={() => !atToday && onChange(shift(value, 1))}
          disabled={atToday}
          style={[styles.step, atToday && { opacity: 0.35 }]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: atToday }}
        >
          <Text style={styles.stepTxt}>›</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[
          { iso: today, text: "Today" },
          { iso: yesterday, text: "Yesterday" },
          { iso: shift(today, -7), text: "A week ago" },
        ].map((q) => (
          <Pressable
            key={q.text}
            onPress={() => onChange(q.iso)}
            style={[styles.quick, value === q.iso && styles.quickOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: value === q.iso }}
          >
            <Text style={{ color: value === q.iso ? "#fff" : theme.colors.textDim, fontSize: 13, fontWeight: "600" }}>
              {q.text}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    padding: 4,
    ...inset("rgba(255,255,255,0.06)"),
  },
  step: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  stepTxt: { color: "#fff", fontSize: 26, lineHeight: 28, fontWeight: "600" },
  label: { flex: 1, textAlign: "center", color: "#fff", fontSize: 15, fontWeight: "700" },
  quick: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickOn: { borderColor: "rgba(255,255,255,0.5)", ...raised("rgba(255,255,255,0.15)") },
});
