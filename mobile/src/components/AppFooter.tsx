import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { theme } from "../theme";
import { useToast } from "../state/toast";
import { UpdateModal } from "./UpdateModal";
import { checkForUpdate, fetchLatest, isAndroid } from "../lib/appUpdate";
import type { AndroidRelease } from "../shared/appVersion";
import { REPO_URL } from "../shared/appVersion";
import { ADMIN_URL } from "../config";

// Open links in an in-app browser (Custom Tab / SafariVC) instead of kicking
// the user out to the system browser. This keeps the Split+ app alive in the
// background so returning lands on the exact same screen — no cold restart and
// no inconsistent re-loading splash. Falls back silently if unavailable.
async function openInApp(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: theme.colors.bg,
      controlsColor: theme.colors.primary,
    });
  } catch {
    /* ignore — nothing else we can do */
  }
}

/**
 * App-wide footer shown at the bottom of every page. Lets the user MANUALLY
 * check for updates (in addition to the automatic check on launch) and reach
 * the GitHub repo + web admin panel. No "Download app" link here — the app is
 * already installed, and updates are handled by "Check for updates".
 */
export function AppFooter({ style }: { style?: object }) {
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<AndroidRelease | null>(null);
  const [show, setShow] = useState(false);

  async function checkNow() {
    if (busy) return;
    setBusy(true);
    try {
      const release = await fetchLatest();
      if (!release) {
        error("Couldn't check for updates. Try again later.");
        return;
      }
      const { isUpdate } = await checkForUpdate(release);
      if (isUpdate) {
        setLatest(release);
        setShow(true);
      } else {
        success("You're on the latest version ✓");
      }
    } catch {
      error("Couldn't check for updates. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        {isAndroid && (
          <Pressable onPress={checkNow} hitSlop={8} style={styles.item} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={theme.colors.textDim} />
            ) : (
              <Text style={styles.itemTxt}>↻ Check for updates</Text>
            )}
          </Pressable>
        )}

        <Pressable onPress={() => openInApp(REPO_URL)} hitSlop={8} style={styles.item}>
          <Text style={styles.itemTxt}>★ GitHub</Text>
        </Pressable>

        <Pressable onPress={() => openInApp(ADMIN_URL)} hitSlop={8} style={styles.item}>
          <Text style={styles.itemTxt}>🛡 Admin</Text>
        </Pressable>
      </View>

      {latest && (
        <UpdateModal latest={latest} visible={show} onClose={() => setShow(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 22, paddingBottom: 8, alignItems: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 18 },
  item: { paddingVertical: 4 },
  itemTxt: { color: theme.colors.textFaint, fontSize: 12, fontWeight: "600" },
});
