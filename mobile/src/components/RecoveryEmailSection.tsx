import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Input, Label } from "./ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { theme } from "../theme";

type Mode = "view" | "edit" | "code" | "remove";

// Settings section for the optional recovery email (mirrors the web field):
// current passphrase + 6-digit code to add/change it; passphrase to remove it.
export function RecoveryEmailSection({ visible }: { visible: boolean }) {
  const { user, setUser } = useAuth();
  const { success, error } = useToast();
  const [mode, setMode] = useState<Mode>("view");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMode("view");
    setEmail("");
    setPass("");
    setCode("");
  }, [visible]);

  const fail = (err: unknown) => error(err instanceof ApiError ? err.message : "Something went wrong");

  async function sendCode() {
    if (!email.trim() || !pass) return error("Enter the email and your current passphrase");
    setBusy(true);
    try {
      const r = await api.emailStart(email.trim(), pass);
      setSentTo(r.sentTo);
      setCode("");
      setMode("code");
      success(`Code sent to ${r.sentTo}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const { user: updated } = await api.emailVerify(code.trim());
      setUser(updated);
      setPass("");
      setMode("view");
      success("Recovery email saved");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pass) return error("Enter your current passphrase");
    setBusy(true);
    try {
      const { user: updated } = await api.emailRemove(pass);
      setUser(updated);
      setPass("");
      setMode("view");
      success("Recovery email removed");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Label>Recovery email</Label>

      {mode === "view" && (
        <>
          <View style={styles.row}>
            <Text style={[styles.val, !user?.email && { color: theme.colors.textFaint }]} numberOfLines={1}>
              {user?.email ? `✓ ${user.email}` : "Not set"}
            </Text>
            <Pressable onPress={() => setMode("edit")} hitSlop={8}>
              <Text style={styles.action}>{user?.email ? "Change" : "Add"}</Text>
            </Pressable>
            {user?.email && (
              <Pressable onPress={() => setMode("remove")} hitSlop={8}>
                <Text style={[styles.action, { color: theme.colors.red }]}>Remove</Text>
              </Pressable>
            )}
          </View>
          <Text style={[styles.hint, { marginTop: 6 }]}>
            {user?.email
              ? "Used to reset your passphrase. You can also log in with it."
              : "Optional. Lets you reset a forgotten passphrase by email, and log in with it."}
          </Text>
        </>
      )}

      {mode === "edit" && (
        <View style={{ gap: 8 }}>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <Input value={pass} onChangeText={setPass} placeholder="Current passphrase" secureTextEntry />
          <View style={styles.btnRow}>
            <Button title="Cancel" variant="ghost" onPress={() => setMode("view")} style={{ flex: 1 }} />
            <Button title="Send code" onPress={sendCode} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      {mode === "code" && (
        <View style={{ gap: 8 }}>
          <Text style={styles.hint}>Enter the 6-digit code we sent to {sentTo}. Check spam too.</Text>
          <Input
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
          />
          <View style={styles.btnRow}>
            <Button title="Resend" variant="ghost" onPress={sendCode} disabled={busy} style={{ flex: 1 }} />
            <Button title="Verify" onPress={verify} loading={busy} disabled={code.length !== 6} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      {mode === "remove" && (
        <View style={{ gap: 8 }}>
          <Text style={styles.hint}>Without a recovery email you'll only be able to log in with your name.</Text>
          <Input value={pass} onChangeText={setPass} placeholder="Current passphrase" secureTextEntry autoFocus />
          <View style={styles.btnRow}>
            <Button title="Cancel" variant="ghost" onPress={() => setMode("view")} style={{ flex: 1 }} />
            <Button title="Remove email" variant="danger" onPress={remove} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  val: { flex: 1, color: "#fff", fontWeight: "600" },
  action: { color: theme.colors.primary, fontWeight: "700" },
  hint: { color: theme.colors.textFaint, fontSize: 12 },
  btnRow: { flexDirection: "row", gap: 8 },
});
