import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, Input, Label } from "../components/ui";
import { RecoverSheet } from "../components/RecoverSheet";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { ApiError } from "../lib/api";
import { theme } from "../theme";
import type { SelfUser } from "../shared/types";

type Mode = "login" | "register";

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { login, register, finishAuth } = useAuth();
  const { success, error } = useToast();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRecover, setShowRecover] = useState(false);

  // After signup we show the one-time recovery code, THEN finish auth so the
  // code screen isn't skipped (mirrors the web flow).
  const [recovery, setRecovery] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<SelfUser | null>(null);

  async function submit() {
    if (!name.trim() || !pass) return error("Enter your name and passphrase");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(name.trim(), pass);
        success(`Welcome back, ${name.trim()}!`);
      } else {
        const { user, recoveryCode } = await register(name.trim(), pass);
        setPendingUser(user);
        setRecovery(recoveryCode);
      }
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (recovery) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Card strong style={{ padding: 24, width: "100%", maxWidth: 420 }}>
          <Text style={styles.h1}>Save your recovery code</Text>
          <Text style={styles.sub}>
            Shown once. You'll need it to reset your passphrase if you forget it.
          </Text>
          <View style={styles.codeBox}>
            <Text selectable style={styles.code}>
              {recovery}
            </Text>
          </View>
          <Text style={styles.tiny}>Tap and hold the code to copy it.</Text>
          <Button
            title="I've saved it — continue"
            onPress={() => {
              if (pendingUser) finishAuth(pendingUser);
              setRecovery(null);
              setPendingUser(null);
            }}
            style={{ marginTop: 16 }}
          />
        </Card>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.center, { paddingTop: insets.top + 40, paddingBottom: 40 }]}>
        <Text style={styles.brand}>Split+</Text>
        <Text style={styles.tagline}>Create groups. Split any bill. Settle up with confidence.</Text>

        <Card strong style={{ padding: 20, width: "100%", maxWidth: 420, marginTop: 24 }}>
          <View style={styles.tabs}>
            {(["login", "register"] as Mode[]).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.tab, mode === m && styles.tabActive]}>
                <Text style={[styles.tabText, mode === m && { color: "#fff" }]}>
                  {m === "login" ? "Log in" : "Sign up"}
                </Text>
              </Pressable>
            ))}
          </View>

          <Label>Your name</Label>
          <Input value={name} onChangeText={setName} placeholder="e.g. Raktim" autoCapitalize="words" />

          <View style={{ height: 12 }} />
          <Label>Passphrase</Label>
          <Input value={pass} onChangeText={setPass} placeholder="••••••••" secureTextEntry />

          <Button
            title={mode === "login" ? "Log in" : "Create account"}
            onPress={submit}
            loading={busy}
            style={{ marginTop: 20 }}
          />

          {mode === "login" && (
            <Pressable onPress={() => setShowRecover(true)} style={{ alignSelf: "center", marginTop: 14 }}>
              <Text style={styles.forgot}>Forgot your passphrase?</Text>
            </Pressable>
          )}
        </Card>

        <Text style={styles.footer}>
          No email needed. Your name + passphrase is your account — invite friends by their name.
        </Text>
      </ScrollView>

      <RecoverSheet visible={showRecover} onClose={() => setShowRecover(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  brand: { fontSize: 48, fontWeight: "900", color: "#fff", letterSpacing: -1 },
  tagline: { color: theme.colors.textDim, textAlign: "center", marginTop: 8, maxWidth: 320 },
  tabs: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 16, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 12 },
  tabActive: { backgroundColor: "rgba(255,255,255,0.15)" },
  tabText: { color: theme.colors.textFaint, fontWeight: "700" },
  footer: { color: theme.colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 20, maxWidth: 340 },
  forgot: { color: theme.colors.textDim, fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  h1: { color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" },
  sub: { color: theme.colors.textDim, textAlign: "center", marginTop: 6 },
  tiny: { color: theme.colors.textFaint, fontSize: 11, textAlign: "center", marginTop: 10 },
  codeBox: {
    marginTop: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 16,
    alignItems: "center",
  },
  code: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: 3 },
});
