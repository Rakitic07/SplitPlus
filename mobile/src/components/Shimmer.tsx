import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type TextStyle, type ViewStyle } from "react-native";
import { theme } from "../theme";

function usePulse() {
  const v = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

export function Skeleton({ style }: { style?: ViewStyle }) {
  const opacity = usePulse();
  return <Animated.View style={[styles.skeleton, style, { opacity }]} />;
}

export function ShimmerText({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  const opacity = usePulse();
  return <Animated.Text style={[styles.shimmerText, style, { opacity }]}>{children}</Animated.Text>;
}

// One glyph that continuously breathes between a dim and bright opacity. Each
// letter is phase-shifted by its index (a one-time leading delay before an
// endless loop), so the bright spot travels across the word as a smooth wave —
// no vertical movement (which caused the shake) and no dark gaps.
const HALF = 520; // ms for one dim→bright (or bright→dim) leg
const STEP = 150; // per-letter phase offset

function ShimmerChar({ char, index, textStyle }: { char: string; index: number; textStyle?: TextStyle }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: HALF, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: HALF, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    // Delay once, then loop forever → a permanent phase offset per letter.
    const anim = Animated.sequence([Animated.delay(index * STEP), breathe]);
    anim.start();
    return () => anim.stop();
  }, [v, index]);

  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return (
    <Animated.Text style={[styles.wordmark, textStyle, { opacity }]}>
      {char === " " ? "\u00A0" : char}
    </Animated.Text>
  );
}

/**
 * The "Split+" wordmark that shimmers letter-by-letter: a soft highlight wave
 * travels across the glyphs themselves (no rectangle band / label). Pure JS
 * Animated so it needs no extra native modules.
 */
export function ShimmerWordmark({
  text = "Split+",
  textStyle,
  style,
}: {
  text?: string;
  textStyle?: TextStyle;
  style?: ViewStyle;
}) {
  const chars = Array.from(text);
  return (
    <View style={[styles.wordmarkRow, style]}>
      {chars.map((c, i) => (
        <ShimmerChar key={`${c}-${i}`} char={c} index={i} textStyle={textStyle} />
      ))}
    </View>
  );
}

export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton style={{ width: 44, height: 44, borderRadius: 16 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton style={{ width: "55%", height: 12 }} />
        <Skeleton style={{ width: "35%", height: 10 }} />
      </View>
      <Skeleton style={{ width: 48, height: 14 }} />
    </View>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 10 },
  shimmerText: { color: theme.colors.textDim, fontWeight: "700" },
  wordmark: { color: "#fff", fontWeight: "900" },
  wordmarkRow: { flexDirection: "row", alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, paddingVertical: 12 },
});
