import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Button, Input, Label } from "./ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { theme } from "../theme";

const DEFAULT_SERVER = "https://ntfy.sh";
const STORE_URL =
  Platform.OS === "ios"
    ? "https://apps.apple.com/app/ntfy/id1625396347"
    : "https://play.google.com/store/apps/details?id=io.heckel.ntfy";

// Optional push notifications for settlements through the ntfy app (mirrors
// the web NtfySettings).
export function NtfySection({ visible }: { visible: boolean }) {
  const { user, setUser } = useAuth();
  const { success, error } = useToast();
  const saved = user?.ntfy ?? null;
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState("");
  const [server, setServer] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "test" | "off" | "new">(null);

  useEffect(() => {
    if (visible) setEditing(false);
  }, [visible]);

  const fail = (err: unknown) => error(err instanceof ApiError ? err.message : "Something went wrong");

  async function newTopic() {
    setBusy("new");
    try {
      setTopic((await api.ntfySuggest()).topic);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function startEditing() {
    const custom = saved && saved.server !== DEFAULT_SERVER ? saved.server : "";
    setServer(custom);
    setShowServer(!!custom);
    setEditing(true);
    if (saved) setTopic(saved.topic);
    else await newTopic();
  }

  const serverUrl = (editing ? server.trim() : saved?.server) || DEFAULT_SERVER;
  const currentTopic = editing ? topic.trim() : saved?.topic ?? "";

  async function openInNtfy() {
    const host = serverUrl.replace(/^https:\/\//, "");
    try {
      await Linking.openURL(`ntfy://${host}/${currentTopic}`);
    } catch {
      error("Install the ntfy app first");
    }
  }

  async function shareTopic() {
    try {
      await Share.share({ message: currentTopic });
    } catch {
      /* user cancelled */
    }
  }

  async function test() {
    setBusy("test");
    try {
      if (editing) await api.ntfyTest(topic.trim(), server.trim());
      else await api.ntfyTest();
      success("Test sent. Check your notifications.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const { user: updated } = await api.ntfySave(topic.trim(), server.trim());
      setUser(updated);
      setEditing(false);
      success("Phone notifications are on");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function turnOff() {
    setBusy("off");
    try {
      const { user: updated } = await api.ntfyRemove();
      setUser(updated);
      success("Phone notifications turned off");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View>
      <Label>Phone notifications (ntfy · optional)</Label>
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.bell}>🔔</Text>
          <Text style={[styles.hint, { flex: 1 }]}>
            {saved ? "On. You'll get a push for every settlement." : "Get a push when someone pays you or confirms your payment."}
          </Text>
          {!editing && (
            <Pressable onPress={startEditing} hitSlop={8}>
              <Text style={styles.action}>{saved ? "Change" : "Set up"}</Text>
            </Pressable>
          )}
        </View>

        {!editing && saved && (
          <View style={{ gap: 8, marginTop: 10 }}>
            <Pressable onPress={shareTopic} style={styles.topicBox}>
              <Text style={styles.topic} numberOfLines={1}>
                {saved.topic}
              </Text>
              <Text style={styles.action}>Share</Text>
            </Pressable>
            <View style={styles.btnRow}>
              <Button title="Send test" variant="ghost" onPress={test} loading={busy === "test"} style={{ flex: 1 }} />
              <Button title="Turn off" variant="danger" onPress={turnOff} loading={busy === "off"} style={{ flex: 1 }} />
            </View>
          </View>
        )}

        {editing && (
          <View style={{ gap: 10, marginTop: 12 }}>
            <Text style={styles.step}>
              <Text style={styles.num}>1 </Text>Install the free ntfy app (no account needed).{" "}
              <Text style={styles.link} onPress={() => Linking.openURL(STORE_URL)}>
                Get ntfy ›
              </Text>
            </Text>
            <Text style={styles.step}>
              <Text style={styles.num}>2 </Text>
              {Platform.OS === "android"
                ? "Tap “Open in ntfy” below to subscribe in one tap, or in ntfy tap + and paste the topic."
                : "In ntfy, tap + and paste the topic below (share it to copy)."}
              {serverUrl === DEFAULT_SERVER ? "" : ` Use server ${serverUrl}.`}
            </Text>
            <Text style={styles.step}>
              <Text style={styles.num}>3 </Text>Tap Send test, then Save.
            </Text>

            <Input
              value={topic}
              onChangeText={(t) => setTopic(t.replace(/\s/g, ""))}
              placeholder="splitplus-…"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.linkRow}>
              {Platform.OS === "android" && (
                <Pressable onPress={openInNtfy} hitSlop={6} disabled={!currentTopic}>
                  <Text style={styles.action}>Open in ntfy</Text>
                </Pressable>
              )}
              <Pressable onPress={shareTopic} hitSlop={6} disabled={!currentTopic}>
                <Text style={styles.action}>Share topic</Text>
              </Pressable>
              <Pressable onPress={newTopic} hitSlop={6} disabled={busy === "new"}>
                <Text style={styles.action}>New random</Text>
              </Pressable>
            </View>
            <Text style={styles.warn}>
              Anyone who knows this topic can read these notifications. Keep it private; the random one is safest.
            </Text>

            {showServer ? (
              <Input
                value={server}
                onChangeText={(t) => setServer(t.trim())}
                placeholder={DEFAULT_SERVER}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            ) : (
              <Pressable onPress={() => setShowServer(true)} hitSlop={6}>
                <Text style={styles.hint}>Using your own ntfy server?</Text>
              </Pressable>
            )}

            <View style={styles.btnRow}>
              <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} disabled={!!busy} style={{ flex: 1 }} />
              <Button title="Test" variant="ghost" onPress={test} loading={busy === "test"} disabled={!topic.trim()} style={{ flex: 1 }} />
              <Button title="Save" onPress={save} loading={busy === "save"} disabled={!topic.trim()} style={{ flex: 1 }} />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  bell: { fontSize: 18 },
  hint: { color: theme.colors.textFaint, fontSize: 12 },
  action: { color: theme.colors.primary, fontWeight: "700" },
  topicBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  topic: { flex: 1, color: "rgba(255,255,255,0.85)", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },
  step: { color: "rgba(255,255,255,0.7)", fontSize: 12.5, lineHeight: 18 },
  num: { color: theme.colors.primary, fontWeight: "800" },
  link: { color: theme.colors.primary, fontWeight: "700" },
  linkRow: { flexDirection: "row", gap: 18, flexWrap: "wrap" },
  warn: { color: "rgba(253,230,138,0.7)", fontSize: 11 },
  btnRow: { flexDirection: "row", gap: 8 },
});
