import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View, type ViewStyle } from "react-native";
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8, paddingVertical: 12 },
});
