// E2E test for sessions (sliding renewal, policy, logout-all, revocation on
// reset) and the image URLs. Run against a local API started with a throwaway
// secret so the test can mint an "old" token:
//   export TEST_SECRET=$(openssl rand -hex 32)
//   AUTH_SECRET=$TEST_SECRET PORT=8799 npx tsx server/index.ts &
//   TEST_SECRET=$TEST_SECRET node scripts/check-sessions.mjs [baseUrl]
import { SignJWT, decodeJwt } from "jose";

const BASE = process.argv[2] ?? "http://localhost:8799/api";
const SECRET = process.env.TEST_SECRET;
if (!SECRET) throw new Error("Set TEST_SECRET to the AUTH_SECRET the test server uses.");

let pass = 0;
let fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

async function call(method, path, body, token, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return {
    status: res.status,
    headers: res.headers,
    data: isJson ? await res.json().catch(() => ({})) : null,
    bytes: isJson ? 0 : (await res.arrayBuffer()).byteLength,
  };
}

const DAY = 86400;
const id = Date.now().toString(36);
const name = `sesstest${id}`;

const reg = await call("POST", "/auth/register", { name, passphrase: "first-pass" });
check("register", reg.status === 201);
const token = reg.data.token;
const userId = reg.data.user.id;
check("default policy is 6 months", reg.data.user.sessionPolicy === "6months");
const ttl = (t) => {
  const p = decodeJwt(t);
  return Math.round((p.exp - p.iat) / DAY);
};
check("6-month token lifetime", ttl(token) === 180, `${ttl(token)} days`);

// A fresh token is not renewed on every request.
const me1 = await call("GET", "/auth/me", null, token);
check("me authenticated", me1.data.authenticated === true);
check("fresh token not renewed", !me1.headers.get("x-session-token"));

// A two-day-old token (sv 0, like pre-upgrade tokens) slides forward.
const now = Math.floor(Date.now() / 1000);
const old = await new SignJWT({ userId, name })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt(now - 2 * DAY)
  .setExpirationTime(now + 28 * DAY)
  .sign(new TextEncoder().encode(SECRET));
const me2 = await call("GET", "/home", null, old);
const renewed = me2.headers.get("x-session-token");
check("old token still works", me2.status === 200);
check("old token renewed via header", !!renewed && renewed !== old);
check("renewed token lasts 180 days", renewed && ttl(renewed) === 180);
check("renewed cookie set", (me2.headers.get("set-cookie") ?? "").includes("splitplus_session="));

// Stale Bearer must not shadow a valid cookie.
const expired = await new SignJWT({ userId, name })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt(now - 40 * DAY)
  .setExpirationTime(now - DAY)
  .sign(new TextEncoder().encode(SECRET));
const viaCookie = await call("GET", "/auth/me", null, expired, {
  Cookie: `splitplus_session=${token}`,
});
check("expired Bearer falls back to cookie", viaCookie.data.authenticated === true);

// Policy: never.
const never = await call("PATCH", "/auth/settings", { sessionPolicy: "never" }, token);
check("set policy never", never.status === 200 && never.data.user.sessionPolicy === "never");
check("never-policy token is long-lived", never.data.token && ttl(never.data.token) >= 3650);
const bad = await call("PATCH", "/auth/settings", { sessionPolicy: "forever" }, token);
check("invalid policy rejected", bad.status === 400);

// Second device, then log out everywhere.
const login2 = await call("POST", "/auth/login", { name, passphrase: "first-pass" });
const device2 = login2.data.token;
check("second device logged in", login2.status === 200 && !!device2);
const all = await call("POST", "/auth/logout-all", null, never.data.token);
check("logout-all ok", all.status === 200);
check("logout-all sends no renewed token", !all.headers.get("x-session-token"));
const after1 = await call("GET", "/auth/me", null, device2);
check("device 2 signed out", after1.data.authenticated === false);
const after2 = await call("GET", "/home", null, never.data.token);
check("device 1 gets session 401", after2.status === 401 && after2.data.code === "session");
const relog = await call("POST", "/auth/login", { name, passphrase: "first-pass" });
check("can log back in", relog.status === 200);
check("policy persisted across logins", relog.data.user.sessionPolicy === "never");
const fresh = relog.data.token;

// Recovery-code reset revokes other sessions but keeps the resetting device.
const recover = await call("POST", "/auth/recover", {
  name,
  recoveryCode: reg.data.recoveryCode,
  passphrase: "second-pass",
});
check("recover ok", recover.status === 200);
check("old session revoked by reset", (await call("GET", "/auth/me", null, fresh)).data.authenticated === false);
check("resetting device stays in", (await call("GET", "/auth/me", null, recover.data.token)).data.authenticated === true);
const t = recover.data.token;

// Images are served by URL, not inlined.
const px =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const s1 = await call("PATCH", "/auth/settings", { avatar: px }, t);
const avatarUrl = s1.data.user.avatar;
check("avatar returned as URL", typeof avatarUrl === "string" && /^https?:\/\/.+\/api\/img\/u\//.test(avatarUrl), avatarUrl);
const proxied = await call("GET", "/auth/me", null, t, {
  "X-Forwarded-Host": "split.example",
  "X-Forwarded-Proto": "https",
});
check("URL follows forwarded host", proxied.data.user.avatar?.startsWith("https://split.example/api/img/u/"));
const img = await call("GET", avatarUrl.replace(/^.*\/api/, ""));
check("image served", img.status === 200 && img.headers.get("content-type") === "image/png" && img.bytes > 0);
check("image cached immutably", (img.headers.get("cache-control") ?? "").includes("immutable"));
const wrongVer = await call("GET", avatarUrl.replace(/^.*\/api/, "").replace(/[^/]+$/, "nope"));
check("wrong version is 404", wrongVer.status === 404);
const echo = await call("PATCH", "/auth/settings", { avatar: avatarUrl }, t);
check("echoed URL leaves avatar unchanged", echo.data.user.avatar === avatarUrl);
const svg = await call("PATCH", "/auth/settings", { avatar: "data:image/svg+xml;base64,PHN2Zy8+" }, t);
const svgImg = await call("GET", svg.data.user.avatar.replace(/^.*\/api/, ""));
check("SVG is never served", svgImg.status === 404);
const cleared = await call("PATCH", "/auth/settings", { avatar: "" }, t);
check("empty string clears avatar", cleared.data.user.avatar === null);

const g = await call("POST", "/groups", { name: `Img ${id}`, thumbnail: px }, t);
check("group created with cover URL", /\/api\/img\/g\//.test(g.data.group?.thumbnail ?? ""));
const home = await call("GET", "/home", null, t);
const card = home.data.groups.find((x) => x.id === g.data.group.id);
check("home lists cover by URL", card?.thumbnail === g.data.group.thumbnail);
check("home payload has no base64", !JSON.stringify(home.data).includes("base64,"));
const patched = await call("PATCH", `/groups/${g.data.group.id}`, { name: "Renamed", thumbnail: card.thumbnail }, t);
check("group edit keeps cover when URL echoed", patched.data.group?.thumbnail === card.thumbnail);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
