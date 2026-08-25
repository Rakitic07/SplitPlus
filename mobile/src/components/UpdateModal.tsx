import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../theme";
import { useToast } from "../state/toast";
import { downloadAndInstall, openInBrowser } from "../lib/appUpdate";
import type { AndroidRelease } from "../shared/appVersion";

type Phase = "prompt" | "downloading" | "installing";

// Themed "update available" popup. Downloads the new APK in the background with
// a progress bar, then hands it to the system installer.
export function UpdateModal({
  latest,
  visible,
  onClose,
}: {
  latest: AndroidRelease;
  visible: boolean;
  onClose: () => void;
}) {
  const { error, success } = useToast();
  const [phase, setPhase] = useState<Phase>("prompt");
  const [pct, setPct] = useState(0);

  async function update() {
    setPhase("downloading");
    setPct(0);
    try {
      await downloadAndInstall(latest, (r) => setPct(Math.min(100, Math.round(r * 100))));
      setPhase("installing");
      success("Downloaded — follow the prompt to install");
      onClose();
    } catch {
      error("Couldn't download in-app. Opening in your browser…");
      await openInBrowser(latest);
      onClose();
    } finally {
      setPhase("prompt");
      setPct(0);
    }
  }

  const downloading = phase === "downloading";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={downloading ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <LinearGradient colors={theme.gradients.primary} style={styles.iconBadge}>
              <Text style={{ fontSize: 26 }}>⬆️</Text>
            </LinearGradient>
          </View>

          <Text style={styles.title}>Update available</Text>
          <Text style={styles.sub}>
            A newer version of Split+{latest.versionName ? ` (${latest.versionName})` : ""} is ready.
            {"\n"}It downloads in the background, then installs.
          </Text>

          {downloading ? (
            <View style={{ width: "100%", marginTop: 20 }}>
              <View style={styles.track}>
                <LinearGradient
                  colors={theme.gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.fill, { width: `${Math.max(6, pct)}%` }]}
                />
              </View>
              <Text style={styles.pct}>Downloading… {pct}%</Text>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable style={styles.later} onPress={onClose}>
                <Text style={styles.laterTxt}>Later</Text>
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={update}>
                <LinearGradient
                  colors={theme.gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.update}
                >
                  <Text style={styles.updateTxt}>Update now</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: theme.colors.bgElevated,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 24,
    alignItems: "center",
  },
  iconWrap: { marginBottom: 14 },
  iconBadge: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  sub: { color: theme.colors.textDim, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },
  actions: { flexDirection: "row", gap: 10, marginTop: 22, alignSelf: "stretch" },
  later: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  laterTxt: { color: theme.colors.textDim, fontWeight: "700" },
  update: { paddingVertical: 14, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  updateTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  track: { height: 10, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.1)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 6 },
  pct: { color: theme.colors.textDim, fontSize: 12, textAlign: "center", marginTop: 10, fontWeight: "600" },
});
