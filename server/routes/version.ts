import { Router } from "express";
import {
  ANDROID_RELEASE,
  APK_ASSET_NAME,
  GITHUB_REPO,
  type AndroidRelease,
} from "../../shared/appVersion.js";

// Version endpoint the native app polls to detect updates. `android.assetSha`
// is the sha256 of the latest APK on GitHub Releases; the app remembers the
// digest it last installed and offers an in-app update whenever this differs —
// so re-uploading a new binary to the same tag ("latest") is enough to ship it.
// (Mirrors the Spendly-Plus /api/version logic.)
export const versionRouter = Router();

// Repo can be overridden at runtime without a code change.
const REPO = process.env.GITHUB_REPO || GITHUB_REPO;

type GithubAsset = {
  name: string;
  browser_download_url: string;
  // sha256 of the uploaded file, e.g. "sha256:c4f2764...". Present on newer
  // uploads; when absent we fall back to fields that still change on re-upload.
  digest?: string | null;
  updated_at?: string;
  id?: number;
};
type GithubRelease = {
  tag_name?: string;
  name?: string;
  assets?: GithubAsset[];
};

// Optional versionCode hint if the tag looks like "v<N>". Not required — the app
// detects updates by the APK's sha256 (see `assetFingerprint`), so a fixed tag
// like "latest" that gets re-uploaded still works.
function tagToVersionCode(tag?: string): number {
  if (!tag) return 0;
  const m = /^v?(\d+)$/.exec(tag.trim());
  return m ? Number(m[1]) : 0;
}

// A value that changes whenever a NEW APK is uploaded — even to the same tag.
// Prefer the real sha256 digest; fall back to the asset's updated timestamp / id.
function assetFingerprint(asset?: GithubAsset): string {
  if (!asset) return "";
  if (asset.digest) return asset.digest.toLowerCase();
  if (asset.updated_at) return `u:${asset.updated_at}`;
  if (asset.id != null) return `id:${asset.id}`;
  return "";
}

// Tiny in-memory cache so a burst of app launches stays well under GitHub's
// 60 req/hr/IP unauthenticated limit while still picking up fresh uploads fast.
let cache: { at: number; value: AndroidRelease } | null = null;
const CACHE_MS = 60_000;

async function latestAndroidFromGithub(): Promise<AndroidRelease | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "split-plus",
    };
    // Optional token lifts the rate limit and allows private repos.
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
    if (!res.ok) return null;

    const rel = (await res.json()) as GithubRelease;
    const asset = rel.assets?.find((a) => a.name === APK_ASSET_NAME);
    const url =
      asset?.browser_download_url ??
      `https://github.com/${REPO}/releases/latest/download/${APK_ASSET_NAME}`;

    const value: AndroidRelease = {
      versionCode: tagToVersionCode(rel.tag_name),
      versionName: rel.name?.trim() || rel.tag_name || "latest",
      url,
      assetSha: assetFingerprint(asset),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

versionRouter.get("/version", async (_req, res) => {
  const web = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  const android = (await latestAndroidFromGithub()) ?? ANDROID_RELEASE;
  res.set("Cache-Control", "no-store").json({ web, android });
});
