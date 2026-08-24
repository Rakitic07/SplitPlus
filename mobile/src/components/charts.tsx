import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { theme } from "../theme";
import { categoryMeta } from "../shared/categories";
import { formatMoney } from "../shared/currency";
import { colorForName } from "../lib/utils";
import type { Balance, Expense } from "../shared/types";

export function CategoryDonut({ expenses, currency }: { expenses: Expense[]; currency: string }) {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  const data = [...map.entries()]
    .map(([name, value]) => ({ name, value, color: categoryMeta(name).color }))
    .sort((a, b) => b.value - a.value);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <NoData />;

  const size = 168;
  const stroke = 24;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <View style={{ gap: 16 }}>
      <View style={{ alignItems: "center" }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            {data.map((d) => {
              const dash = (d.value / total) * c;
              const el = (
                <Circle
                  key={d.name}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={d.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                  fill="transparent"
                  strokeLinecap="butt"
                />
              );
              offset += dash;
              return el;
            })}
          </G>
        </Svg>
        <View style={styles.donutCenter}>
          <Text style={styles.donutTotal}>{formatMoney(currency, total)}</Text>
          <Text style={styles.donutLabel}>total</Text>
        </View>
      </View>
      <View style={{ gap: 6 }}>
        {data.slice(0, 6).map((d) => (
          <View key={d.name} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: d.color }]} />
            <Text style={styles.legendName} numberOfLines={1}>
              {categoryMeta(d.name).emoji} {d.name}
            </Text>
            <Text style={styles.legendVal}>{formatMoney(currency, d.value)}</Text>
            <Text style={styles.legendPct}>{Math.round((d.value / total) * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PaidByBars({ expenses, currency }: { expenses: Expense[]; currency: string }) {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.paidBy.name, (map.get(e.paidBy.name) ?? 0) + e.amount);
  const data = [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  if (data.length === 0) return <NoData />;
  const max = Math.max(...data.map((d) => d.value));
  return (
    <View style={{ gap: 10 }}>
      {data.map((d) => (
        <View key={d.name} style={{ gap: 4 }}>
          <View style={styles.barTop}>
            <Text style={styles.barName}>{d.name}</Text>
            <Text style={styles.barVal}>{formatMoney(currency, d.value)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[styles.barFill, { width: `${(d.value / max) * 100}%`, backgroundColor: colorForName(d.name) }]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export function BalanceBars({ balances, currency }: { balances: Balance[]; currency: string }) {
  const data = balances.filter((b) => Math.abs(b.net) > 0.01).sort((a, b) => b.net - a.net);
  if (data.length === 0) return <NoData label="Everyone's settled up 🎉" />;
  const max = Math.max(...data.map((d) => Math.abs(d.net)));
  return (
    <View style={{ gap: 10 }}>
      {data.map((b) => (
        <View key={b.id} style={{ gap: 4 }}>
          <View style={styles.barTop}>
            <Text style={styles.barName}>{b.name}</Text>
            <Text style={[styles.barVal, { color: b.net >= 0 ? theme.colors.green : theme.colors.red }]}>
              {b.net >= 0 ? "+" : "−"}
              {formatMoney(currency, Math.abs(b.net))}
            </Text>
          </View>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${(Math.abs(b.net) / max) * 100}%`,
                  backgroundColor: b.net >= 0 ? theme.colors.green : theme.colors.red,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function NoData({ label = "No data yet" }: { label?: string }) {
  return (
    <View style={{ paddingVertical: 32, alignItems: "center" }}>
      <Text style={{ color: theme.colors.textFaint }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  donutCenter: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  donutTotal: { color: "#fff", fontWeight: "800", fontSize: 18 },
  donutLabel: { color: theme.colors.textFaint, fontSize: 12 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendName: { color: theme.colors.textDim, flex: 1, fontSize: 14 },
  legendVal: { color: "#fff", fontWeight: "700", fontSize: 14 },
  legendPct: { color: theme.colors.textFaint, width: 40, textAlign: "right", fontSize: 12 },
  barTop: { flexDirection: "row", justifyContent: "space-between" },
  barName: { color: theme.colors.textDim, fontSize: 14 },
  barVal: { color: "#fff", fontWeight: "700", fontSize: 14 },
  barTrack: { height: 10, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 6, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 6 },
});
