// Generates the Split+ app icons (web PWA + Expo mobile) from the brand mark so
// the logo renders correctly everywhere — no more white borders / boxes.
//
// Run:  node scripts/gen-icons.mjs
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const GRAD = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8a3d"/>
      <stop offset="0.55" stop-color="#ffab33"/>
      <stop offset="1" stop-color="#ffc23d"/>
    </linearGradient>
  </defs>`;

// The two swap arrows, in the shared 0..64 coordinate space.
function arrows(scale = 1) {
  const t =
    scale === 1
      ? ""
      : ` transform="translate(32,32) scale(${scale}) translate(-32,-32)"`;
  return `
  <g${t} stroke="#fff" stroke-width="${(4.5 / scale).toFixed(2)}" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 25 H40"/>
    <path d="M34 19 L42 25 L34 31"/>
    <path d="M45 39 H24"/>
    <path d="M30 33 L22 39 L30 45"/>
  </g>`;
}

// Full-bleed gradient tile (platforms apply their own rounding/mask).
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${GRAD}
  <rect x="0" y="0" width="64" height="64" fill="url(#g)"/>${arrows(1)}</svg>`;

// Rounded logo on transparent — for the dark splash screen.
const roundedLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${GRAD}
  <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#g)"/>${arrows(1)}</svg>`;

// Circular full-bleed — for the Android round launcher icon.
const circleFull = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${GRAD}
  <circle cx="32" cy="32" r="32" fill="url(#g)"/>${arrows(1)}</svg>`;

const jobs = [
  // Web / PWA
  { svg: fullBleed, size: 1024, out: "public/app-icon.png", transparent: false },
  { svg: fullBleed, size: 180, out: "public/apple-touch-icon.png", transparent: false },
  { svg: fullBleed, size: 192, out: "public/icon-192.png", transparent: false },
  { svg: fullBleed, size: 512, out: "public/icon-512.png", transparent: false },
  { svg: fullBleed, size: 512, out: "public/icon-maskable-512.png", transparent: false },
  // Mobile (Expo) — icon.png is full-bleed & opaque (no alpha) so it also works
  // as the Android adaptive foreground and passes App Store icon checks.
  { svg: fullBleed, size: 1024, out: "mobile/assets/icon.png", transparent: false },
  { svg: roundedLogo, size: 1024, out: "mobile/assets/splash-icon.png", transparent: true },
];

// The native android/ project is prebuilt & committed (kept so the Kotlin build
// fix isn't lost to `prebuild --clean`), so its baked launcher icons must be
// regenerated directly. Foreground is a full-bleed opaque tile → the adaptive
// icon looks identical to iOS regardless of the background layer.
const ANDROID_RES = "mobile/android/app/src/main/res";
const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const foreground = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [d, px] of Object.entries(legacy)) {
  jobs.push({ svg: fullBleed, size: px, out: `${ANDROID_RES}/mipmap-${d}/ic_launcher.png`, transparent: false });
  jobs.push({ svg: circleFull, size: px, out: `${ANDROID_RES}/mipmap-${d}/ic_launcher_round.png`, transparent: true });
}
for (const [d, px] of Object.entries(foreground)) {
  jobs.push({ svg: fullBleed, size: px, out: `${ANDROID_RES}/mipmap-${d}/ic_launcher_foreground.png`, transparent: false });
}
// Native splash logo (rounded brand mark on transparent → shows on the dark bg).
const splash = { mdpi: 288, hdpi: 432, xhdpi: 576, xxhdpi: 864, xxxhdpi: 1152 };
for (const [d, px] of Object.entries(splash)) {
  jobs.push({ svg: roundedLogo, size: px, out: `${ANDROID_RES}/drawable-${d}/splashscreen_logo.png`, transparent: true });
}

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const page = await browser.newPage({
      viewport: { width: job.size, height: job.size },
      deviceScaleFactor: 1,
    });
    const html = `<!doctype html><html><head><style>
      *{margin:0;padding:0}html,body{width:${job.size}px;height:${job.size}px;background:transparent}
      svg{display:block;width:${job.size}px;height:${job.size}px}
    </style></head><body>${job.svg}</body></html>`;
    await page.setContent(html, { waitUntil: "networkidle" });
    const el = await page.$("svg");
    const buf = await el.screenshot({ omitBackground: job.transparent });
    const abs = resolve(root, job.out);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    console.log(`✓ ${job.out} (${job.size}px)`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Done.");
