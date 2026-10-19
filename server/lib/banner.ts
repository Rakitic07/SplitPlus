import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { prisma } from "./prisma.js";
import { decodeImage } from "./images.js";
import type { BannerPayload } from "./ntfy.js";
import { formatMoney } from "../../shared/currency.js";

// Renders the 2:1 image shown as the big picture in ntfy notifications:
// payer → receiver avatars, the amount, the group, and the group cover (if
// any) washed into the background. SVG → PNG with resvg (Android won't show
// SVG attachments). Fonts are bundled because serverless hosts have none.

const W = 1024;
const H = 512;
const FONT_DIR = path.join(process.cwd(), "server", "assets", "fonts");
const FONTS = [path.join(FONT_DIR, "Inter_800ExtraBold.ttf"), path.join(FONT_DIR, "Inter_600SemiBold.ttf")];

const AVATAR_COLORS = ["#ff8a3d", "#ffc23d", "#f7a072", "#e8b04b", "#c98a3d", "#b5895f", "#d4a017", "#9aa0ad", "#e07a5f", "#caa15e"];
function colorForName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Only raster data URLs we already validate elsewhere; anything else is dropped.
const safeImage = (data?: string | null) => (data && decodeImage(data) ? data : null);

type Person = { name: string; avatar: string | null };
type BannerData = {
  amount: string;
  group: string;
  cover: string | null;
  from: Person;
  to: Person;
  status: { label: string; color: string };
};

const STATUS = {
  pending: { label: "AWAITING CONFIRMATION", color: "#ffc23d" },
  approved: { label: "CONFIRMED", color: "#34d399" },
  declined: { label: "DECLINED", color: "#f87171" },
  test: { label: "TEST NOTIFICATION", color: "#7dd3fc" },
};

async function load(p: BannerPayload): Promise<BannerData | null> {
  if (p.k === "t") {
    const u = await prisma.user.findUnique({
      where: { id: p.u },
      select: { name: true, avatar: true, defaultCurrency: true },
    });
    if (!u) return null;
    return {
      amount: formatMoney(u.defaultCurrency, 1250),
      group: "Split+ test",
      cover: null,
      from: { name: "Your friend", avatar: null },
      to: { name: u.name, avatar: safeImage(u.avatar) },
      status: STATUS.test,
    };
  }
  const s = await prisma.settlement.findUnique({
    where: { id: p.id },
    select: {
      amount: true,
      group: { select: { name: true, emoji: true, currency: true, thumbnail: true } },
      from: { select: { name: true, avatar: true } },
      to: { select: { name: true, avatar: true } },
    },
  });
  if (!s) return null;
  return {
    amount: formatMoney(s.group.currency, s.amount),
    group: s.group.name,
    cover: safeImage(s.group.thumbnail),
    from: { name: s.from.name, avatar: safeImage(s.from.avatar) },
    to: { name: s.to.name, avatar: safeImage(s.to.avatar) },
    status: STATUS[p.st],
  };
}

function avatar(id: string, p: Person, cx: number, cy: number, r: number) {
  const face = p.avatar
    ? `<image href="${p.avatar}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colorForName(p.name)}"/>
       <text x="${cx}" y="${cy + r * 0.27}" text-anchor="middle" font-size="${r * 0.78}" font-weight="800" fill="#fff">${esc(initials(p.name))}</text>`;
  return `
    <clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="url(#halo)"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="url(#ring)" stroke-width="6"/>
    ${face}`;
}

function svg(d: BannerData): string {
  const amountSize = d.amount.length > 12 ? 70 : d.amount.length > 9 ? 82 : 96;
  const pillW = d.status.label.length * 13 + 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a1a0a"/><stop offset="0.55" stop-color="#160f07"/><stop offset="1" stop-color="#0c0905"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#120c06" stop-opacity="0.55"/><stop offset="1" stop-color="#0c0905" stop-opacity="0.92"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.55" r="0.55">
      <stop offset="0" stop-color="#ff8a3d" stop-opacity="0.42"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo"><stop offset="0.6" stop-color="#ff9a3d" stop-opacity="0.35"/><stop offset="1" stop-color="#ff9a3d" stop-opacity="0"/></radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd76b"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient>
    <linearGradient id="amt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffab33"/><stop offset="0.5" stop-color="#ffe2a8"/><stop offset="1" stop-color="#ffc23d"/></linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a3d"/><stop offset="0.55" stop-color="#ffab33"/><stop offset="1" stop-color="#ffc23d"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${d.cover ? `<image href="${d.cover}" x="-40" y="-40" width="${W + 80}" height="${H + 80}" preserveAspectRatio="xMidYMid slice" opacity="0.55" filter="url(#blur)"/>` : ""}
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <ellipse cx="${W / 2}" cy="300" rx="520" ry="300" fill="url(#glow)"/>

  <g transform="translate(48,38)">
    <rect width="54" height="54" rx="15" fill="url(#mark)"/>
    <g stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="scale(0.84)">
      <path d="M17 25 H38"/><path d="M32 19 L40 25 L32 31"/><path d="M47 39 H26"/><path d="M32 33 L24 39 L32 45"/>
    </g>
    <text x="70" y="26" font-size="26" font-weight="800" fill="#ffcf8a">Split+</text>
    <text x="70" y="52" font-size="20" font-weight="600" fill="#ffffff" fill-opacity="0.62">${esc(clip(d.group, 34))}</text>
  </g>

  <g transform="translate(${W - 48 - pillW},46)">
    <rect width="${pillW}" height="40" rx="20" fill="${d.status.color}" fill-opacity="0.16" stroke="${d.status.color}" stroke-opacity="0.6" stroke-width="2"/>
    <circle cx="22" cy="20" r="6" fill="${d.status.color}"/>
    <text x="36" y="27" font-size="17" font-weight="800" fill="${d.status.color}" letter-spacing="1.2">${esc(d.status.label)}</text>
  </g>

  <text x="${W / 2}" y="214" text-anchor="middle" font-size="${amountSize}" font-weight="800" fill="url(#amt)" letter-spacing="-2">${esc(d.amount)}</text>

  <path d="M318 318 C 430 252, 594 252, 706 318" fill="none" stroke="#ffc23d" stroke-opacity="0.75" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 16"/>
  <polygon points="0,-13 24,0 0,13" fill="#ffc23d" transform="translate(704,317) rotate(30)"/>
  ${[0.3, 0.5, 0.7]
    .map((t) => {
      const x = (1 - t) ** 3 * 318 + 3 * (1 - t) ** 2 * t * 430 + 3 * (1 - t) * t ** 2 * 594 + t ** 3 * 706;
      const y = (1 - t) ** 3 * 318 + 3 * (1 - t) ** 2 * t * 252 + 3 * (1 - t) * t ** 2 * 252 + t ** 3 * 318;
      const r = t === 0.5 ? 17 : 13;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#ffd76b" stroke="#ff9a3d" stroke-width="3"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r * 0.5}" fill="none" stroke="#e8891f" stroke-opacity="0.7" stroke-width="2"/>`;
    })
    .join("")}

  ${avatar("fa", d.from, 214, 330, 84)}
  ${avatar("ta", d.to, 810, 330, 84)}

  <text x="214" y="466" text-anchor="middle" font-size="28" font-weight="800" fill="#fff">${esc(clip(d.from.name, 16))}</text>
  <text x="214" y="496" text-anchor="middle" font-size="19" font-weight="600" fill="#ffffff" fill-opacity="0.55">paid</text>
  <text x="810" y="466" text-anchor="middle" font-size="28" font-weight="800" fill="#fff">${esc(clip(d.to.name, 16))}</text>
  <text x="810" y="496" text-anchor="middle" font-size="19" font-weight="600" fill="#ffffff" fill-opacity="0.55">receives</text>
</svg>`;
}

export async function renderBanner(p: BannerPayload): Promise<Buffer | null> {
  const data = await load(p);
  if (!data) return null;
  const r = new Resvg(svg(data), {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter" },
    fitTo: { mode: "width", value: W },
  });
  return r.render().asPng();
}
