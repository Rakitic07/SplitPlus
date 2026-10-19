import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar, Button, SheetRoot } from "./ui";
import { formatMoney } from "../shared/currency";
import { categoryMeta } from "../shared/categories";
import { theme } from "../theme";
import type { Expense, PublicUser } from "../shared/types";

const COIN = "#ffd76b";
const OWES = "#ff8f8f";

type Bubble = { id: string; name: string; fullName: string; avatar?: string | null; x: number; y: number; r: number; share: number };
type Flow = { to: Bubble; sx: number; sy: number; tx: number; ty: number; angle: number; len: number; start: number };

// Same layout as the web ExpenseFlow: payer in the middle, everyone whose share
// they covered on a ring around them. `S` is the stage size in points.
function layout(expense: Expense, members: PublicUser[], myId: string, S: number) {
  const k = S / 360;
  const C = S / 2;
  const byId = new Map(members.map((m) => [m.id, m]));
  const label = (id: string, name: string) => (id === myId ? "You" : name);
  const payerId = expense.paidBy.id;
  const others = expense.shares.filter((s) => s.userId !== payerId && s.amount > 0.004);
  const n = others.length;
  const r = (n <= 4 ? 27 : n <= 8 ? 22 : 17) * k;
  const ring = (n <= 6 ? 118 : 128) * k;

  const payer: Bubble = {
    id: payerId,
    name: label(payerId, expense.paidBy.name),
    fullName: expense.paidBy.name,
    avatar: byId.get(payerId)?.avatar ?? expense.paidBy.avatar,
    x: n === 1 ? 92 * k : C,
    y: C,
    r: 34 * k,
    share: expense.shares.find((s) => s.userId === payerId)?.amount ?? 0,
  };

  const stagger = Math.min(0.45, 2.4 / Math.max(1, n));
  const borrowers: Bubble[] = others.map((s, i) => {
    const a = (90 + ((i + 0.5) * 360) / n) * (Math.PI / 180);
    return {
      id: s.userId,
      name: label(s.userId, s.name),
      fullName: s.name,
      avatar: byId.get(s.userId)?.avatar,
      x: n === 1 ? S - 92 * k : C + ring * Math.cos(a),
      y: n === 1 ? C : C + ring * Math.sin(a),
      r,
      share: s.amount,
    };
  });

  const flows: Flow[] = borrowers.map((b, i) => {
    const dx = b.x - payer.x;
    const dy = b.y - payer.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const sx = payer.x + ux * (payer.r + 4);
    const sy = payer.y + uy * (payer.r + 4);
    const tx = b.x - ux * (b.r + 7);
    const ty = b.y - uy * (b.r + 7);
    return {
      to: b,
      sx,
      sy,
      tx,
      ty,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      len: Math.hypot(tx - sx, ty - sy),
      start: 0.9 + i * stagger,
    };
  });

  const end = flows.length ? flows[flows.length - 1].start + 1.2 : 0.8;
  return { payer, borrowers, flows, end, C };
}

const short = (s: string) => (s.length > 11 ? `${s.slice(0, 10)}…` : s);

// Plays how one expense moved money (mirrors the web ExpenseFlowModal): coins
// travel from the payer to each person whose share they covered.
export function ExpenseFlowSheet({
  expense,
  members,
  myId,
  currency,
  onClose,
}: {
  expense: Expense | null;
  members: PublicUser[];
  myId: string;
  currency: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const S = Math.min(width - 40, 360);
  const t = useRef(new Animated.Value(0)).current;
  const money = (v: number) => formatMoney(currency, v);

  const data = useMemo(
    () => (expense ? layout(expense, members, myId, S) : null),
    [expense, members, myId, S]
  );

  const play = useCallback(async () => {
    if (!data) return;
    t.stopAnimation();
    t.setValue(0);
    if (await AccessibilityInfo.isReduceMotionEnabled()) {
      t.setValue(data.end + 1);
      return;
    }
    Animated.timing(t, {
      toValue: data.end + 1,
      duration: (data.end + 1) * 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [data, t]);

  useEffect(() => {
    if (expense) play();
  }, [expense, play]);

  const iv = (input: number[], output: number[], ease = false) =>
    t.interpolate({
      inputRange: input,
      outputRange: output,
      extrapolate: "clamp",
      easing: ease ? Easing.inOut(Easing.ease) : undefined,
    });

  const renderBubble = (b: Bubble, delay: number, sub: string, subColor: string, subAt: number) => {
    const above = b.y < (data?.C ?? 0) - 1;
    const pop = iv([delay, delay + 0.22, delay + 0.38], [0, 1.12, 1]);
    const labelW = 110;
    const labels = (
      <>
        <Text style={styles.name} numberOfLines={1}>
          {short(b.name)}
        </Text>
        <Animated.Text
          style={[
            styles.sub,
            { color: subColor, opacity: iv([subAt, subAt + 0.3], [0, 1]) },
            { transform: [{ translateY: iv([subAt, subAt + 0.3], [6, 0]) }] },
          ]}
        >
          {sub}
        </Animated.Text>
      </>
    );
    return (
      <View key={b.id} pointerEvents="none">
        <Animated.View
          style={{
            position: "absolute",
            left: b.x - b.r - 3,
            top: b.y - b.r - 3,
            width: (b.r + 3) * 2,
            height: (b.r + 3) * 2,
            borderRadius: b.r + 3,
            borderWidth: 2,
            borderColor: "rgba(255,200,120,0.5)",
            alignItems: "center",
            justifyContent: "center",
            opacity: iv([delay, delay + 0.15], [0, 1]),
            transform: [{ scale: pop }],
          }}
        >
          <Avatar name={b.fullName} uri={b.avatar} size={b.r * 2} />
        </Animated.View>
        <Animated.View
          style={{
            position: "absolute",
            left: b.x - labelW / 2,
            width: labelW,
            alignItems: "center",
            ...(above ? { top: b.y - b.r - 40 } : { top: b.y + b.r + 5 }),
            opacity: iv([delay, delay + 0.2], [0, 1]),
          }}
        >
          {labels}
        </Animated.View>
      </View>
    );
  };

  const cat = expense ? categoryMeta(expense.category) : null;

  return (
    <Modal visible={!!expense} transparent animationType="slide" onRequestClose={onClose}>
      <SheetRoot style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {expense && data && (
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.title} numberOfLines={1}>
              {cat?.emoji} {expense.title}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ width: S, height: S, alignSelf: "center" }}>
                {data.flows.map((f) => (
                  <React.Fragment key={f.to.id}>
                    <Animated.View
                      style={[
                        styles.line,
                        {
                          left: f.sx,
                          top: f.sy - 1.25,
                          width: f.len,
                          transformOrigin: "left center",
                          opacity: iv([f.start, f.start + 0.1], [0, 0.75]),
                          transform: [
                            { rotate: `${f.angle}deg` },
                            { scaleX: iv([f.start, f.start + 0.45], [0.001, 1]) },
                          ],
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.arrow,
                        {
                          left: f.tx - 5,
                          top: f.ty - 5,
                          opacity: iv([f.start + 0.4, f.start + 0.6], [0, 1]),
                          transform: [{ rotate: `${f.angle}deg` }],
                        },
                      ]}
                    />
                    {[0, 1, 2].map((j) => {
                      const s = f.start + 0.15 + j * 0.13;
                      const size = j === 0 ? 12 : 9;
                      return (
                        <Animated.View
                          key={j}
                          style={[
                            styles.coin,
                            {
                              width: size,
                              height: size,
                              borderRadius: size / 2,
                              left: -size / 2,
                              top: -size / 2,
                              opacity: iv([s, s + 0.08, s + 0.65, s + 0.75], [0, 1, 1, 0]),
                              transform: [
                                { translateX: iv([s, s + 0.75], [f.sx, f.tx], true) },
                                { translateY: iv([s, s + 0.75], [f.sy, f.ty], true) },
                              ],
                            },
                          ]}
                        />
                      );
                    })}
                    <Animated.View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: f.to.x - f.to.r,
                        top: f.to.y - f.to.r,
                        width: f.to.r * 2,
                        height: f.to.r * 2,
                        borderRadius: f.to.r,
                        borderWidth: 2,
                        borderColor: COIN,
                        opacity: iv([f.start + 0.85, f.start + 0.86, f.start + 1.45], [0, 0.9, 0]),
                        transform: [{ scale: iv([f.start + 0.85, f.start + 1.45], [1, 1.55]) }],
                      }}
                    />
                  </React.Fragment>
                ))}

                {data.flows.map((f, i) =>
                  renderBubble(f.to, 0.3 + i * 0.06, money(f.to.share), OWES, f.start + 0.85)
                )}
                {renderBubble(data.payer, 0, `paid ${money(expense.amount)}`, "#6ee7b7", 0.45)}
              </View>

              <Animated.View style={{ gap: 6, marginTop: 8, opacity: iv([data.end, data.end + 0.35], [0, 1]) }}>
                {data.borrowers.length === 0 ? (
                  <Text style={styles.note}>
                    {data.payer.name} paid for {data.payer.name === "You" ? "yourself" : "themselves"} — nothing to split.
                  </Text>
                ) : (
                  <>
                    {data.borrowers.map((b) => (
                      <View key={b.id} style={styles.row}>
                        <Text style={styles.rowText} numberOfLines={1}>
                          <Text style={styles.bold}>{b.name}</Text> {b.name === "You" ? "owe" : "owes"}{" "}
                          <Text style={styles.bold}>{data.payer.name}</Text>
                        </Text>
                        <Text style={styles.rowAmt}>{money(b.share)}</Text>
                      </View>
                    ))}
                    {data.payer.share > 0.004 && (
                      <Text style={styles.note}>
                        {data.payer.name === "You" ? "Your" : `${data.payer.name}'s`} own share: {money(data.payer.share)}
                      </Text>
                    )}
                  </>
                )}
              </Animated.View>
            </ScrollView>
            <Button title="▶  Play again" onPress={play} style={{ marginTop: 14 }} />
          </View>
        )}
      </SheetRoot>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: theme.colors.bgElevated,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: "92%",
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  line: { position: "absolute", height: 2.5, borderRadius: 2, backgroundColor: "#ffab33" },
  arrow: {
    position: "absolute",
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 10,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#ffc23d",
  },
  coin: { position: "absolute", backgroundColor: COIN, borderWidth: 1.5, borderColor: "#ff9a3d" },
  name: { color: "rgba(255,255,255,0.92)", fontSize: 12.5, fontWeight: "700" },
  sub: { fontSize: 11.5, fontWeight: "700", marginTop: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowText: { flex: 1, color: "rgba(255,255,255,0.75)", fontSize: 14 },
  bold: { color: "#fff", fontWeight: "700" },
  rowAmt: { color: OWES, fontWeight: "800" },
  note: { color: theme.colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 4 },
});
