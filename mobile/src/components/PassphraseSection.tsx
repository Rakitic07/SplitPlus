import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Input, Label } from "./ui";
import { api, ApiError } from "../lib/api";
import { useToast } from "../state/toast";
import { theme } from "../theme";

// Change the passphrase while signed in (mirrors the web PassphraseField).
// Other devices are signed out; this one stays signed in.
export function PassphraseSection({ visible }: { visible: boolean }) {
  const { success, error } = useToast();
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEditing(false);
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  useEffect(() => {
    if (visible) reset();
  }, [visible]);

  async function save() {
    if (!current) return error("Enter your current passphrase");
    if (next.length < 6) return error("New passphrase must be at least 6 characters");
    if (next !== confirm) return error("The new passphrases don't match");
    if (next === current) return error("New passphrase must be different from the current one");
    setBusy(true);
    try {
      await api.changePassphrase(current, next);
      reset();
      success("Passphrase changed. Other devices were signed out.");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't change passphrase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Label>Passphrase</Label>
      {editing ? (
        <View style={{ gap: 8 }}>
          <Input value={current} onChangeText={setCurrent} placeholder="Current passphrase" secureTextEntry autoFocus />
          <Input value={next} onChangeText={setNext} placeholder="New passphrase" secureTextEntry />
          <Input value={confirm} onChangeText={setConfirm} placeholder="Confirm new passphrase" secureTextEntry />
          <Text style={styles.hint}>At least 6 characters. Other devices will be signed out.</Text>
          <View style={styles.btnRow}>
            <Button title="Cancel" variant="ghost" onPress={reset} disabled={busy} style={{ flex: 1 }} />
            <Button title="Update" onPress={save} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Text style={styles.val}>••••••••</Text>
          <Pressable onPress={() => setEditing(true)} hitSlop={8}>
            <Text style={styles.action}>Change</Text>
          </Pressable>
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
  val: { flex: 1, color: theme.colors.textFaint, fontWeight: "600", letterSpacing: 3 },
  action: { color: theme.colors.primary, fontWeight: "700" },
  hint: { color: theme.colors.textFaint, fontSize: 12 },
  btnRow: { flexDirection: "row", gap: 8 },
});
