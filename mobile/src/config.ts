// Where the mobile app talks to the Split+ API.
//
// • Production: set EXPO_PUBLIC_API_BASE to your deployed Vercel URL, e.g.
//     EXPO_PUBLIC_API_BASE=https://split-plus.vercel.app/api
// • Local dev: a phone/emulator can't reach "localhost" on your Mac, so use your
//   machine's LAN IP, e.g. http://192.168.1.20:8787/api (run `npm run dev` in the
//   web project first). Android emulator can use http://10.0.2.2:8787/api.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:8787/api";

// The deployed website origin (API_BASE without the trailing "/api") and the
// admin dashboard URL. The admin panel is a rich web page (charts, storage &
// host metrics), so the mobile app opens it in the browser rather than
// re-implementing it natively.
export const SITE_BASE = API_BASE.replace(/\/api\/?$/, "");
export const ADMIN_URL = `${SITE_BASE}/admin`;

// A unique identifier baked into THIS binary at build time (git sha + timestamp,
// injected by the Makefile). Lets the app recognise when a brand-new APK has just
// been installed — so the in-app updater treats the freshly installed build as
// "current" instead of falsely offering an update to the very binary you're on.
// Empty for builds made without the Makefile (e.g. `expo start`).
export const BUILD_ID = process.env.EXPO_PUBLIC_BUILD_ID ?? "";
