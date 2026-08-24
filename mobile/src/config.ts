// Where the mobile app talks to the Split+ API.
//
// • Production: set EXPO_PUBLIC_API_BASE to your deployed Vercel URL, e.g.
//     EXPO_PUBLIC_API_BASE=https://split-plus.vercel.app/api
// • Local dev: a phone/emulator can't reach "localhost" on your Mac, so use your
//   machine's LAN IP, e.g. http://192.168.1.20:8787/api (run `npm run dev` in the
//   web project first). Android emulator can use http://10.0.2.2:8787/api.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:8787/api";
