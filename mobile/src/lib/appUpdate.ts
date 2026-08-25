// In-app update check for the Android app — mirrors the Spendly-Plus logic.
//
// Detection is based on the APK's sha256 (the release ASSET digest), NOT the git
// tag/commit — updates are shipped by re-uploading a new binary to a single
// fixed release tag ("latest"), so the tag never changes but the APK's sha256
// does. The app remembers the digest it last installed and offers an update
// whenever the latest release's digest differs.
//
// The APK is downloaded silently in the background to the app cache; we then
// hand the file to the system package installer (Android requires a user tap to
// confirm the install — silent install isn't possible without a system app).
// The cached APK is removed afterwards so nothing is left lying around.
import { Linking, Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { api } from "./api";
import { storage } from "./storage";
import { BUILD_ID } from "../config";
import type { AndroidRelease } from "../shared/appVersion";

const DIGEST_KEY = "splitplus_apk_digest";
// The release digest we've ALREADY surfaced a popup for — so we prompt once per
// new version instead of nagging on every single app launch.
const PROMPTED_KEY = "splitplus_prompted_digest";
// The BUILD_ID of the binary we last ran. When this changes we know a brand-new
// APK was just installed and treat it as "current".
const BUILD_KEY = "splitplus_build_id";
const APK_PATH = `${FileSystem.cacheDirectory}split-plus-update.apk`;
// FLAG_GRANT_READ_URI_PERMISSION — lets the installer read our content:// uri.
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Fetches the latest release info (APK sha256 + url) from the backend. */
export async function fetchLatest(): Promise<AndroidRelease | null> {
  try {
    const { android } = await api.version();
    return android ?? null;
  } catch {
    return null;
  }
}

/** The APK digest this app currently considers installed. */
export async function installedDigest(): Promise<string> {
  return (await storage.getItem(DIGEST_KEY)) ?? "";
}

/** Record the digest we consider installed so we don't re-prompt for it. */
export async function markInstalled(assetSha: string): Promise<void> {
  if (!assetSha) return;
  await storage.setItem(DIGEST_KEY, assetSha);
}

/** The release digest we've already shown a popup for. */
export async function promptedDigest(): Promise<string> {
  return (await storage.getItem(PROMPTED_KEY)) ?? "";
}

/** Remember we've surfaced the popup for this digest (prompt once per version). */
export async function markPrompted(assetSha: string): Promise<void> {
  if (!assetSha) return;
  await storage.setItem(PROMPTED_KEY, assetSha);
}

/**
 * Update check based on the remembered installed digest vs the latest release
 * asset digest. On the very first run (no remembered digest) we seed the
 * baseline to the current latest and report "no update" — a fresh install
 * always has the newest binary.
 */
export async function checkForUpdate(
  latest: AndroidRelease | null
): Promise<{ installed: string; latest: string; isUpdate: boolean }> {
  const latestSha = latest?.assetSha ?? "";

  // If the binary's BUILD_ID changed since we last ran, a fresh APK was just
  // installed — it IS the current version by definition. Reseed the baseline to
  // the latest release and don't prompt, so a freshly sideloaded/updated build
  // never falsely offers an "update" to itself. (Only for builds that bake a
  // BUILD_ID; older builds fall through to the digest heuristic below.)
  if (BUILD_ID) {
    const lastBuild = await storage.getItem(BUILD_KEY);
    if (lastBuild !== BUILD_ID) {
      await storage.setItem(BUILD_KEY, BUILD_ID);
      if (latestSha) await markInstalled(latestSha);
      return { installed: latestSha, latest: latestSha, isUpdate: false };
    }
  }

  const seen = await installedDigest();

  if (!seen) {
    // First launch: seed the baseline; don't prompt.
    if (latestSha) await markInstalled(latestSha);
    return { installed: latestSha, latest: latestSha, isUpdate: false };
  }

  return {
    installed: seen,
    latest: latestSha,
    isUpdate: !!latestSha && seen !== latestSha,
  };
}

/** Remove any leftover downloaded APK (called on launch + after installing). */
export async function cleanupStaleApk(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(APK_PATH);
    if (info.exists) await FileSystem.deleteAsync(APK_PATH, { idempotent: true });
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Downloads the latest APK in the background (reporting progress 0..1) and opens
 * the system installer. Records the digest so we don't re-prompt, and clears the
 * cached APK once the installer has been handed the file.
 */
export async function downloadAndInstall(
  latest: AndroidRelease,
  onProgress?: (ratio: number) => void
): Promise<void> {
  await cleanupStaleApk();

  const dl = FileSystem.createDownloadResumable(latest.url, APK_PATH, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) {
      onProgress?.(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    }
  });

  const res = await dl.downloadAsync();
  if (!res?.uri) throw new Error("Download failed");
  onProgress?.(1);

  // A file:// path can't be shared with the installer on modern Android; convert
  // it to a content:// uri via expo-file-system's bundled FileProvider.
  const contentUri = await FileSystem.getContentUriAsync(res.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
    data: contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: "application/vnd.android.package-archive",
  });

  // Remember the new digest so we don't re-prompt. We intentionally DON'T delete
  // the APK here — the installer may still be reading it. It's cleaned up on the
  // next app launch (cleanupStaleApk runs on open), so nothing is left behind.
  if (latest.assetSha) await markInstalled(latest.assetSha);
}

/**
 * Fallback: open the APK download in the browser (used if the in-app installer
 * flow isn't available, e.g. a non-Android platform).
 */
export async function openInBrowser(latest: AndroidRelease): Promise<void> {
  try {
    await Linking.openURL(latest.url);
    if (latest.assetSha) await markInstalled(latest.assetSha);
  } catch {
    /* couldn't open browser — leave the digest so we prompt again next launch */
  }
}

export const isAndroid = Platform.OS === "android";
