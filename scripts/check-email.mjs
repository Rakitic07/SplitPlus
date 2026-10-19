// E2E smoke test for the recovery-email flow against a local API.
//   1) Start the API (dev mode prints emails to its console) with output in a
//      log file:   PORT=8799 npx tsx server/index.ts > .email-test.log 2>&1 &
//   2) node scripts/check-email.mjs [baseUrl] [logFile]
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:8799/api";
const LOG = process.argv[3] ?? ".email-test.log";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// The latest 6-digit code mailed to `to`, read from the dev server log.
async function codeFor(to) {
  for (let i = 0; i < 20; i++) {
    const log = readFileSync(LOG, "utf8");
    const blocks = log.split("[mail:dev]").filter((b) => b.includes(`to=${to}`));
    const m = blocks.at(-1)?.match(/Your Split\+ code: (\d{6})/);
    if (m) return m[1];
    await sleep(150);
  }
  return null;
}

const id = Date.now().toString(36);
const name = `mailtest${id}`;
const other = `mailother${id}`;
const email = `${name}@example.com`;

const reg = await call("POST", "/auth/register", { name, passphrase: "first-pass" });
check("register", reg.status === 201);
const token = reg.data.token;
const reg2 = await call("POST", "/auth/register", { name: other, passphrase: "other-pass" });
const otherToken = reg2.data.token;

check(
  "names with @ are rejected at signup",
  (await call("POST", "/auth/register", { name: `x@${id}`, passphrase: "123456" })).status === 400
);
check(
  "email login fails before an email is configured",
  (await call("POST", "/auth/login", { name: email, passphrase: "first-pass" })).status === 401
);

check(
  "start needs the right passphrase",
  (await call("POST", "/auth/email/start", { email, passphrase: "wrong" }, token)).status === 401
);
const start = await call("POST", "/auth/email/start", { email: email.toUpperCase(), passphrase: "first-pass" }, token);
check("start sends a code", start.status === 200, start.data.sentTo);
check(
  "resend is rate-limited",
  (await call("POST", "/auth/email/start", { email, passphrase: "first-pass" }, token)).status === 429
);

const code = await codeFor(email);
check("code was mailed (dev log)", !!code);
const wrong = code === "000000" ? "111111" : "000000";
check("wrong code rejected", (await call("POST", "/auth/email/verify", { code: wrong }, token)).status === 400);
const ver = await call("POST", "/auth/email/verify", { code }, token);
check("verify saves the email (lowercased)", ver.status === 200 && ver.data.user?.email === email);
check("code can't be reused", (await call("POST", "/auth/email/verify", { code }, token)).status === 400);

const me = await call("GET", "/auth/me", null, token);
check("/me exposes the email", me.data.user?.email === email);

const login = await call("POST", "/auth/login", { name: email.toUpperCase(), passphrase: "first-pass" });
check("login with email works", login.status === 200 && login.data.user?.name === name);
check(
  "login with name still works",
  (await call("POST", "/auth/login", { name, passphrase: "first-pass" })).status === 200
);

check(
  "same email can't be claimed by another account",
  (await call("POST", "/auth/email/start", { email, passphrase: "other-pass" }, otherToken)).status === 409
);

const unknown = await call("POST", "/auth/email-reset/request", { identifier: `nobody${id}` });
const req = await call("POST", "/auth/email-reset/request", { identifier: email });
check(
  "reset request answers identically for unknown accounts",
  unknown.status === 200 && req.status === 200 && unknown.data.message === req.data.message
);
const resetCode = await codeFor(email);
check("reset code mailed", !!resetCode && resetCode !== code);
check(
  "reset with wrong code fails",
  (await call("POST", "/auth/email-reset/confirm", { identifier: name, code: wrong, passphrase: "second-pass" }))
    .status === 400
);
const conf = await call("POST", "/auth/email-reset/confirm", {
  identifier: name,
  code: resetCode,
  passphrase: "second-pass",
});
check("reset with right code works", conf.status === 200);
check(
  "old passphrase no longer works",
  (await call("POST", "/auth/login", { name: email, passphrase: "first-pass" })).status === 401
);
const relog = await call("POST", "/auth/login", { name: email, passphrase: "second-pass" });
check("new passphrase works via email login", relog.status === 200);

const rm = await call("POST", "/auth/email/remove", { passphrase: "second-pass" }, relog.data.token);
check("remove email", rm.status === 200 && rm.data.user?.email === null);
check(
  "email login stops working after removal",
  (await call("POST", "/auth/login", { name: email, passphrase: "second-pass" })).status === 401
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
