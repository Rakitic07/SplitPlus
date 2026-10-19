import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";

type Kind = "success" | "error" | "info";
type ToastCtx = {
  toast: (message: string, kind?: Kind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
};
type ToastState = { msg: { text: string; kind: Kind } | null; opacity: Animated.Value };

const Ctx = createContext<ToastCtx | null>(null);
const StateCtx = createContext<ToastState | null>(null);

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

  const value = useMemo<ToastCtx>(
    () => ({
      toast,
      success: (m) => toast(m, "success"),
      error: (m) => toast(m, "error"),
    }),
    [toast]
  );
  const state = useMemo(() => ({ msg, opacity }), [msg, opacity]);

  return (
    <Ctx.Provider value={value}>
      <StateCtx.Provider value={state}>
        {children}
        <ToastView />
      </StateCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * Draws the current toast. RN <Modal> sheets and iOS modal-presented screens
 * sit in their own native window above the app root, hiding the root toast,
 * so each of them renders one of these too. `iosModalScreen` is for stack
 * screens with `presentation: "modal"`: only iOS gives those a separate window.
 */
export function ToastView({ iosModalScreen }: { iosModalScreen?: boolean }) {
  const state = useContext(StateCtx);
  const insets = useSafeAreaInsets();
  if (!state?.msg || (iosModalScreen && Platform.OS !== "ios")) return null;
  const { msg, opacity } = state;
  const accent =
    msg.kind === "success" ? theme.colors.green : msg.kind === "error" ? theme.colors.red : theme.colors.primary;
  return (
    <Animated.View
      style={[styles.wrap, { opacity, top: (iosModalScreen ? 0 : insets.top) + 12 }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole={msg.kind === "error" ? "alert" : "text"}
    >
      <View style={[styles.toast, { borderColor: accent }]}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={styles.text}>{msg.text}</Text>
      </View>
    </Animated.View>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 100, elevation: 100 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "90%",
    backgroundColor: theme.mode === "neumorph" ? theme.colors.cardStrong : "rgba(28,22,15,0.97)",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { color: "#fff", fontSize: 14, fontWeight: "600", flexShrink: 1 },
});
