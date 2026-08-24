import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../theme";
import { colorForName, initials } from "../lib/utils";

export function Card({
  children,
  style,
  strong,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  strong?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: strong ? theme.colors.cardStrong : theme.colors.card,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  icon?: React.ReactNode;
  style?: ViewStyle;
}) {
  const content = (
    <View style={styles.btnInner}>
      {loading ? <ActivityIndicator color="#fff" size="small" /> : icon}
      <Text style={[styles.btnText, variant === "danger" && { color: theme.colors.red }]}>{title}</Text>
    </View>
  );
  if (variant === "primary") {
    return (
      <Pressable onPress={onPress} disabled={disabled || loading} style={[{ opacity: disabled ? 0.6 : 1 }, style]}>
        <LinearGradient
          colors={theme.gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.btn}
        >
          {content}
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.btn, styles.btnGhost, { opacity: disabled ? 0.6 : 1 }, style]}
    >
      {content}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={theme.colors.textFaint}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Avatar({
  name,
  uri,
  size = 40,
}: {
  name: string;
  uri?: string | null;
  size?: number;
}) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colorForName(name),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: size * 0.4 }}>{initials(name)}</Text>
    </View>
  );
}

export function Pill({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        active && { borderColor: color ?? "#fff", backgroundColor: (color ?? "#ffffff") + "26" },
      ]}
    >
      <Text style={[styles.pillText, active && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Empty({ title, subtitle, emoji }: { title: string; subtitle?: string; emoji?: string }) {
  return (
    <View style={styles.empty}>
      {emoji ? <Text style={{ fontSize: 40 }}>{emoji}</Text> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: theme.radius.lg, borderWidth: 1, overflow: "hidden" },
  btn: { borderRadius: theme.radius.md, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center" },
  btnGhost: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "rgba(255,255,255,0.08)" },
  btnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
  },
  label: { color: theme.colors.textDim, fontWeight: "700", fontSize: 13, marginBottom: 6 },
  pill: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: { color: theme.colors.textDim, fontWeight: "600", fontSize: 13 },
  section: {
    color: theme.colors.textFaint,
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  empty: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: { color: "#fff", fontWeight: "700", fontSize: 17 },
  emptySub: { color: theme.colors.textFaint, fontSize: 14, textAlign: "center", maxWidth: 280 },
});
