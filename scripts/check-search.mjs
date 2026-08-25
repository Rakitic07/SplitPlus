// Non-destructive check for the global expense search endpoint. Registers a
// unique user, creates a group with a couple of expenses, then verifies
// GET /api/search returns matching hits carrying their group for deep-linking.
import { spawn } from "node:child_process";

const PORT = process.env.CHECK_PORT || "8803";
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

  const u = client();
  const r = await u.call("POST", "/auth/register", {
    name: `Seek_${uniq}`,
    passphrase: "passphrase1",
  });
  u.set(r.data.token, r.data.user.id);

  const gname = `Trip_${uniq}`;
  const cg = await u.call("POST", "/groups", { name: gname, currency: "INR", emoji: "✈️" });
  const gid = cg.data.group.id;

  const token = `Zanzibar${uniq}`; // unique needle
  await u.call("POST", `/groups/${gid}/expenses`, {
    title: `${token} hotel`,
    category: "Travel",
    amount: 200,
    paidById: u.id,
    date: new Date().toISOString(),
    splitMode: "equal",
    shares: [{ userId: u.id, included: true }],
  });
  await u.call("POST", `/groups/${gid}/expenses`, {
    title: "Groceries",
    category: "Food",
    amount: 50,
    paidById: u.id,
    date: new Date().toISOString(),
    splitMode: "equal",
    shares: [{ userId: u.id, included: true }],
  });

  // Match by title needle.
  const s1 = await u.call("GET", `/search?q=${token}`);
  ok(s1.status === 200, "search returns 200");
  ok(s1.data.results.length === 1, `one hit for needle (got ${s1.data.results.length})`);
  const hit = s1.data.results[0];
  ok(hit && hit.group && hit.group.id === gid, "hit carries the right group");
  ok(hit && hit.group.name === gname, "hit carries group name for the badge");

  // Case-insensitive + match by category.
  const s2 = await u.call("GET", `/search?q=${token.toLowerCase()}`);
  ok(s2.data.results.length === 1, "case-insensitive title match");
  const s3 = await u.call("GET", `/search?q=travel`);
  ok(s3.data.results.some((x) => x.id === hit.id), "category match finds the expense");

  // Too-short queries return nothing.
  const s4 = await u.call("GET", `/search?q=a`);
  ok(Array.isArray(s4.data.results) && s4.data.results.length === 0, "1-char query is ignored");
} catch (e) {
  okAll = false;
  console.error("check-search error:", e.message);
} finally {
  server.kill();
}
process.exitCode = okAll ? 0 : 1;
