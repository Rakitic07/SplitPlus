import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { prisma } from "./prisma.js";
import { requestOrigin } from "./images.js";
import { formatMoney } from "../../shared/currency.js";

// Optional per-user push notifications through ntfy (https://ntfy.sh). Each
// user subscribes to their own topic in the ntfy app; we publish settlement
// events to it with a rendered banner image (see banner.ts).

export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";
const SEND_TIMEOUT_MS = 5000;

export type BannerPayload =
  | { k: "s"; id: string; st: "pending" | "approved" | "declined" }
  | { k: "t"; u: string };

// ── Signed banner URLs ─────────────────────────────────────────────────
// The banner endpoint is public (the phone fetches it without a session), so
// its URL carries an HMAC: nobody can render someone else's settlement by
// guessing ids.
let bannerKey: Buffer | null = null;
function key(): Buffer {
  if (bannerKey) return bannerKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is not set.");
  bannerKey = Buffer.from(hkdfSync("sha256", secret, "split-plus", "ntfy-banner-v1", 32));
  return bannerKey;
}

const sign = (data: string) => createHmac("sha256", key()).update(data).digest("base64url");

export function bannerPath(p: BannerPayload): string {
  const data = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `/api/ntfy/banner/${data}/${sign(data)}.png`;
}

export function verifyBanner(data: string, sig: string): BannerPayload | null {
  const expected = Buffer.from(sign(data));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (p?.k === "s" && typeof p.id === "string" && ["pending", "approved", "declined"].includes(p.st)) return p;
    if (p?.k === "t" && typeof p.u === "string") return p;
  } catch {
    // fall through
  }
  return null;
}

// ── Server address safety ─────────────────────────────────────────────
// Users may point at a self-hosted ntfy server. We POST to it from our
// backend, so refuse anything that resolves to a private/internal address.
function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const low = ip.toLowerCase();
  return low === "::" || low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
}

export async function checkNtfyServer(server: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    return "That server URL isn't valid.";
  }
  if (url.protocol !== "https:") return "The server must use https://.";
  if (url.port && url.port !== "443") return "Custom ports aren't supported.";
  if (url.username || url.password) return "Don't put a username or password in the URL.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || /\.(local|internal|localhost)$/i.test(host)) {
    return "That server isn't reachable from the internet.";
  }
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
      return "That server isn't reachable from the internet.";
    }
  } catch {
    return "Couldn't find that server.";
  }
  return null;
}

export const normalizeServer = (s?: string | null) =>
  (s?.trim() || DEFAULT_NTFY_SERVER).replace(/\/+$/, "");

// ── Publishing ────────────────────────────────────────────────────────
type NtfyMessage = {
  title: string;
  message: string;
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  click?: string;
  banner?: BannerPayload;
};

export class NtfyError extends Error {}

export async function publish(
  target: { topic: string; server?: string | null },
  msg: NtfyMessage
): Promise<void> {
  const server = normalizeServer(target.server);
  if (server !== DEFAULT_NTFY_SERVER) {
    const problem = await checkNtfyServer(server);
    if (problem) throw new NtfyError(problem);
  }
  const origin = requestOrigin();
  const body = {
    topic: target.topic,
    title: msg.title,
    message: msg.message,
    tags: msg.tags,
    priority: msg.priority ?? 3,
    ...(msg.click ? { click: msg.click, actions: [{ action: "view", label: "Open Split+", url: msg.click }] } : {}),
    ...(origin ? { icon: `${origin}/icon-192.png` } : {}),
    ...(origin && msg.banner ? { attach: `${origin}${bannerPath(msg.banner)}`, filename: "split-plus.png" } : {}),
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    // JSON publishing goes to the server root; it carries UTF-8 titles (₹, emoji)
    // that plain HTTP headers can't.
    const res = await fetch(`${server}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new NtfyError(
        res.status === 403 || res.status === 401
          ? "That ntfy topic is protected. Use a public topic or another server."
          : res.status === 429
            ? "ntfy is rate-limiting us. Try again in a minute."
            : `ntfy rejected the message (${res.status}).`
      );
    }
  } catch (err) {
    if (err instanceof NtfyError) throw err;
    throw new NtfyError("Couldn't reach the ntfy server.");
  } finally {
    clearTimeout(timer);
  }
}

// ── Settlement events ─────────────────────────────────────────────────
export type SettlementEvent = "created" | "approved" | "declined";

/**
 * Notify whoever should hear about a settlement change:
 *  • created + pending  → the receiver ("confirm you got it")
 *  • created + approved → the payer (the receiver logged it themselves)
 *  • approved/declined  → the payer
 * Never throws: a push failure must not fail the settlement itself.
 */
export async function notifySettlement(settlementId: string, event: SettlementEvent): Promise<void> {
  try {
    const s = await prisma.settlement.findUnique({
      where: { id: settlementId },
      select: {
        id: true,
        amount: true,
        status: true,
        groupId: true,
        group: { select: { name: true, emoji: true, currency: true } },
        from: { select: { id: true, name: true, ntfyTopic: true, ntfyServer: true } },
        to: { select: { id: true, name: true, ntfyTopic: true, ntfyServer: true } },
      },
    });
    if (!s) return;
    const amt = formatMoney(s.group.currency, s.amount);
    const groupLabel = `${s.group.emoji ? `${s.group.emoji} ` : ""}${s.group.name}`;
    const origin = requestOrigin();
    const click = origin ? `${origin}/g/${s.groupId}` : undefined;
    const st = s.status as "pending" | "approved" | "declined";
    const banner: BannerPayload = { k: "s", id: s.id, st };

    let recipient: typeof s.from;
    let msg: Omit<NtfyMessage, "click" | "banner">;
    if (event === "created" && st === "pending") {
      recipient = s.to;
      msg = {
        title: `${amt} from ${s.from.name}`,
        message: `${groupLabel} · ${s.from.name} says they paid you. Tap to confirm you received it.`,
        tags: ["money_with_wings"],
        priority: 4,
      };
    } else if (event === "created") {
      recipient = s.from;
      msg = {
        title: `${amt} settled with ${s.to.name}`,
        message: `${groupLabel} · ${s.to.name} recorded your payment as received.`,
        tags: ["white_check_mark"],
      };
    } else if (event === "approved") {
      recipient = s.from;
      msg = {
        title: `${amt} confirmed by ${s.to.name}`,
        message: `${groupLabel} · Your payment is confirmed. You're square on this one.`,
        tags: ["white_check_mark"],
      };
    } else {
      recipient = s.from;
      msg = {
        title: `${amt} declined by ${s.to.name}`,
        message: `${groupLabel} · ${s.to.name} says they didn't receive this payment.`,
        tags: ["x"],
        priority: 4,
      };
    }
    if (!recipient.ntfyTopic) return;
    await publish({ topic: recipient.ntfyTopic, server: recipient.ntfyServer }, { ...msg, click, banner });
  } catch (err) {
    console.error("[ntfy] settlement notification failed", err);
  }
}
