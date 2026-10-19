import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { prisma } from "./prisma.js";

// Avatars and group covers are stored as base64 data URLs, but API payloads
// reference them by URL (/api/img/:kind/:id/:ver) so a list of 50 expenses
// doesn't carry the payer's 100KB avatar 50 times. `ver` is a content hash, so
// the image response is immutable and cached by the CDN and the client.

export type ImageKind = "u" | "g";

const originStore = new AsyncLocalStorage<string>();

// Absolute URLs on the origin the client called (the native app needs them for
// <Image source={{ uri }}>; for the browser it's still same-origin).
export const imageOrigin: RequestHandler = (req, _res, next) => {
  const proto =
    String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() || req.protocol;
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
    .split(",")[0]
    .trim();
  const origin = host ? `${proto}://${host}` : "";
  // Fire-and-forget: a cold instance shouldn't hold its first request for this.
  ensureImageVersions().catch((err) => console.error("image version backfill failed:", err));
  originStore.run(origin, next);
};

/** Public origin of the current request, e.g. "https://split-plus.vercel.app". */
export function requestOrigin(): string {
  return originStore.getStore() ?? "";
}

export function imageVersion(data: string): string {
  return createHash("sha256").update(data).digest("base64url").slice(0, 22);
}

export function imageUrl(kind: ImageKind, id: string, ver: string | null | undefined): string | null {
  if (!ver) return null;
  return `${originStore.getStore() ?? ""}/api/img/${kind}/${id}/${ver}`;
}

// Interpret an incoming image field. Clients echo back the URL they were
// given when the image didn't change, so anything that isn't a fresh data URL
// (or "" to clear) means "leave it as it is".
export function imageInput(v: string | null | undefined): { data: string | null; ver: string | null } | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === "") return { data: null, ver: null };
  if (v.startsWith("data:image/")) return { data: v, ver: imageVersion(v) };
  return undefined;
}

export function avatarData(v: string | null | undefined) {
  const img = imageInput(v);
  return img ? { avatar: img.data, avatarVer: img.ver } : {};
}

export function thumbData(v: string | null | undefined) {
  const img = imageInput(v);
  return img ? { thumbnail: img.data, thumbVer: img.ver } : {};
}

// Rows written before versions existed get one backfilled lazily (once per
// server instance; after the first run both queries return nothing).
let backfill: Promise<void> | null = null;
export function ensureImageVersions(): Promise<void> {
  backfill ??= (async () => {
    const users = await prisma.user.findMany({
      where: { avatar: { not: null }, avatarVer: null },
      select: { id: true, avatar: true },
    });
    for (const u of users) {
      await prisma.user.update({
        where: { id: u.id },
        data: { avatarVer: imageVersion(u.avatar!) },
      });
    }
    const groups = await prisma.group.findMany({
      where: { thumbnail: { not: null }, thumbVer: null },
      select: { id: true, thumbnail: true },
    });
    for (const g of groups) {
      await prisma.group.update({
        where: { id: g.id },
        data: { thumbVer: imageVersion(g.thumbnail!) },
      });
    }
  })().catch((err) => {
    backfill = null;
    throw err;
  });
  return backfill;
}

// Only raster types are served — an SVG from our origin could run script.
const SAFE_IMAGE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

export function decodeImage(data: string): { mime: string; bytes: Buffer } | null {
  const m = SAFE_IMAGE.exec(data);
  if (!m) return null;
  return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
}
