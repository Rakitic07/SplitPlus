// Non-destructive check for the overall-export endpoint. Registers a unique
// user, creates two groups with expenses, then verifies GET /api/export/expenses
// returns every expense flattened with its group, currency and the caller's share.
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

  const u = client();
  const r = await u.call("POST", "/auth/register", {
    name: `Exp_${uniq}`,
    passphrase: "passphrase1",
  });
  u.set(r.data.token, r.data.user.id);

  const g1 = await u.call("POST", "/groups", { name: `Trip_${uniq}`, currency: "INR", emoji: "✈️" });
  const g2 = await u.call("POST", "/groups", { name: `Flat_${uniq}`, currency: "USD", emoji: "🏠" });
  const gid1 = g1.data.group.id;
  const gid2 = g2.data.group.id;

  await u.call("POST", `/groups/${gid1}/expenses`, {
    title: `Hotel_${uniq}`,
    category: "Travel",
    amount: 200,
    paidById: u.id,
    date: new Date().toISOString(),
    splitMode: "equal",
    shares: [{ userId: u.id, included: true }],
  });
  await u.call("POST", `/groups/${gid2}/expenses`, {
    title: `Rent_${uniq}`,
    category: "Rent",
    amount: 90,
    paidById: u.id,
    date: new Date().toISOString(),
    splitMode: "equal",
    shares: [{ userId: u.id, included: true }],
  });

  const ex = await u.call("GET", "/export/expenses");
  ok(ex.status === 200, "export returns 200");
  const rows = ex.data.expenses || [];
  ok(rows.length === 2, `two expenses across groups (got ${rows.length})`);

  const inr = rows.find((e) => e.group.id === gid1);
  const usd = rows.find((e) => e.group.id === gid2);
  ok(!!inr && inr.group.currency === "INR", "INR row carries its group currency");
  ok(!!usd && usd.group.currency === "USD", "USD row carries its group currency");
  ok(!!inr && inr.title === `Hotel_${uniq}`, "row carries the expense title");
  ok(!!inr && typeof inr.myShare === "number" && inr.myShare > 0, "row carries the caller's share");
  ok(!!inr && inr.paidBy && inr.paidBy.name === `Exp_${uniq}`, "row carries the payer name");
} catch (e) {
  okAll = false;
  console.error("check-export error:", e.message);
} finally {
  server.kill();
}
process.exitCode = okAll ? 0 : 1;
