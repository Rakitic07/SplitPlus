import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

type Kind = "success" | "error" | "info";
type ToastCtx = {
  toast: (message: string, kind?: Kind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; kind: Kind } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback(
    (text: string, kind: Kind = "info") => {
      setMsg({ text, kind });
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(
          () => setMsg(null)
        );
      }, 2600);
    },
    [opacity]
  );

  const value: ToastCtx = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
  };

  const accent =
    msg?.kind === "success" ? theme.colors.green : msg?.kind === "error" ? theme.colors.red : theme.colors.primary;

  return (
    <Ctx.Provider value={value}>
      {children}
      {msg && (
        <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none">
          <View style={[styles.toast, { borderColor: accent }]}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={styles.text}>{msg.text}</Text>
          </View>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 56, left: 0, right: 0, alignItems: "center", zIndex: 100 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "90%",
    backgroundColor: "rgba(22,24,46,0.96)",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { color: "#fff", fontSize: 14, fontWeight: "600", flexShrink: 1 },
});
