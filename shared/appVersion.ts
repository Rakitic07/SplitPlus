// GitHub repo (owner/name) and release asset that host the Android binary.
//
// TODO: point GITHUB_REPO at the real repository once it exists. The APK asset
// name must match what `mobile/Makefile` produces (outputs/split-plus.apk).
// On the server this can be overridden at runtime with the GITHUB_REPO env var.
export const GITHUB_REPO = "Rakitic07/SplitPlus";
export const APK_ASSET_NAME = "split-plus.apk";

// Handy derived links (browser "Download app" + GitHub button).
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
// Direct link to the APK on the fixed "latest" release tag. Re-uploading a new
// split-plus.apk to that same tag keeps this link pointing at the newest build.
export const RELEASE_APK_URL = `https://github.com/${GITHUB_REPO}/releases/download/latest/${APK_ASSET_NAME}`;

// Offline / rate-limited FALLBACK for the latest Android binary.
//
// The live value comes from the latest GitHub Release (see GET /api/version), so
// normally you only publish/re-upload a release to ship an update. The app
// detects updates by the APK's sha256 (`assetSha`), so a fixed tag like "latest"
// that gets re-uploaded still works.
export type AndroidRelease = {
  versionCode: number;
  versionName: string;
  url: string;
  // sha256 of the latest APK asset (e.g. "sha256:..."), or a fallback token that
  // still changes on every re-upload. The app remembers the digest it installed
  // and offers an update whenever this differs.
  assetSha: string;
};

export const ANDROID_RELEASE: AndroidRelease = {
  versionCode: 1,
  versionName: "1.0",
  url: RELEASE_APK_URL,
  assetSha: "",
};
