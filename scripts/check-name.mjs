// Non-destructive check for the display-name change flow: uniqueness guard +
// "twice per 30 days" limit + case-only tweak allowed for free. Runs on a
// throwaway port against local SQLite.
import "./_guard-local.mjs"; // refuse to run unless targeting local SQLite
import { spawn } from "node:child_process";

const PORT = process.env.CHECK_PORT || "8804";
const BASE = `http://localhost:${PORT}/api`;
const uniq = Date.now().toString(36);

function client() {
  let token = null;
  return {
    id: null,
    async call(method, path, body) {
      const headers = {};
      if (body) headers["Content-Type"] = "application/json";
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    },
    set(t, id) {
      token = t;
      this.id = id;
    },
  };
}

const server = spawn("npx", ["tsx", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT, ADMIN_SECRET: "x" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.env.CHECK_DEBUG && console.error(String(d)));

async function up() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let okAll = true;
const ok = (c, label) => {
  if (!c) okAll = false;
  console.log(`  ${c ? "✓" : "✗"} ${label}`);
};

try {
  if (!(await up())) throw new Error("server never healthy");

  const a = client();
  const b = client();
  const ra = await a.call("POST", "/auth/register", { name: `Ann_${uniq}`, passphrase: "passphrase1" });
  a.set(ra.data.token, ra.data.user.id);
  const rb = await b.call("POST", "/auth/register", { name: `Bob_${uniq}`, passphrase: "passphrase1" });
  b.set(rb.data.token, rb.data.user.id);

  // Fresh account → 2 changes available.
  const s0 = await a.call("GET", "/auth/name-status");
  ok(s0.status === 200 && s0.data.remaining === 2 && s0.data.limit === 2, `starts with 2/2 changes (remaining=${s0.data.remaining})`);

  // Can't take another user's name (case-insensitive).
  const clash = await a.call("PATCH", "/auth/name", { name: `bob_${uniq}` });
  ok(clash.status === 409, "cannot take another user's name (409)");

  // Case-only tweak of OWN name → allowed, does NOT consume quota.
  const caseOnly = await a.call("PATCH", "/auth/name", { name: `ANN_${uniq}` });
  ok(caseOnly.status === 200 && caseOnly.data.user.name === `ANN_${uniq}`, "case-only tweak allowed");
  ok(caseOnly.data.status.remaining === 2, `case-only tweak keeps quota (remaining=${caseOnly.data.status.remaining})`);

  // First real rename → remaining drops to 1.
  const c1 = await a.call("PATCH", "/auth/name", { name: `Alice_${uniq}` });
  ok(c1.status === 200 && c1.data.user.name === `Alice_${uniq}`, "first rename succeeds");
  ok(c1.data.status.remaining === 1, `remaining after 1st rename = 1 (got ${c1.data.status.remaining})`);

  // Second real rename → remaining drops to 0.
  const c2 = await a.call("PATCH", "/auth/name", { name: `Alicia_${uniq}` });
  ok(c2.status === 200 && c2.data.status.remaining === 0, `remaining after 2nd rename = 0 (got ${c2.data.status.remaining})`);
  ok(!!c2.data.status.nextChangeAt, "nextChangeAt is set once exhausted");

  // Third rename → blocked (429).
  const c3 = await a.call("PATCH", "/auth/name", { name: `Alexa_${uniq}` });
  ok(c3.status === 429, `third rename blocked (got ${c3.status})`);

  // The old name is now free — B can take A's previous name.
  const bTake = await b.call("PATCH", "/auth/name", { name: `Alice_${uniq}` });
  ok(bTake.status === 200, "freed-up old name can be taken by another user");

  // Session still valid + reflects the new name after rename.
  const me = await a.call("GET", "/auth/me");
  ok(me.data.authenticated && me.data.user.name === `Alicia_${uniq}`, "me reflects the new name (session intact)");

  // Too-short name rejected by validation.
  const short = await b.call("PATCH", "/auth/name", { name: "x" });
  ok(short.status === 400, "too-short name rejected (400)");
} catch (e) {
  okAll = false;
  console.error("check-name error:", e.message);
} finally {
  server.kill();
}
process.exitCode = okAll ? 0 : 1;
