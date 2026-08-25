// GitHub repo (owner/name) and release asset that host the Android binary.
// Keep in sync with ../../shared/appVersion.ts (web/server copy).
export const GITHUB_REPO = "Rakitic07/SplitPlus";
export const APK_ASSET_NAME = "split-plus.apk";

export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASE_APK_URL = `https://github.com/${GITHUB_REPO}/releases/download/latest/${APK_ASSET_NAME}`;

export type AndroidRelease = {
  versionCode: number;
  versionName: string;
  url: string;
  // sha256 of the latest APK asset (or a token that changes on every re-upload).
  assetSha: string;
};
