// Non-destructive check for the batched GET /api/groups net computation.
// Creates its own unique users/group/expenses on a throwaway port and asserts
// the current user's net matches the old per-group balances math.
import "./_guard-local.mjs"; // refuse to run unless targeting local SQLite
import { spawn } from "node:child_process";

const PORT = process.env.CHECK_PORT || "8802";
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

  const u1 = client();
  const u2 = client();
  const r1 = await u1.call("POST", "/auth/register", { name: `Net1_${uniq}`, passphrase: "passphrase1" });
  u1.set(r1.data.token, r1.data.user.id);
  const r2 = await u2.call("POST", "/auth/register", { name: `Net2_${uniq}`, passphrase: "passphrase1" });
  u2.set(r2.data.token, r2.data.user.id);

  const cg = await u1.call("POST", "/groups", {
    name: `NetGrp_${uniq}`,
    currency: "INR",
    emoji: "🧮",
    inviteeIds: [u2.id],
  });
  const gid = cg.data.group.id;
  const inv = await u2.call("GET", "/invites");
  const mine = inv.data.invites.find((i) => i.group.id === gid);
  await u2.call("POST", `/invites/${mine.id}`, { action: "accept" });

  const detail = await u1.call("GET", `/groups/${gid}`);
  const ids = detail.data.group.members.map((m) => m.id);
  ok(ids.length === 2, "group has 2 members");

  // u1 pays 100 split equally → u1 net +50. u2 pays 40 split equally → u1 net -20.
  await u1.call("POST", `/groups/${gid}/expenses`, {
    title: "Dinner", category: "Food", amount: 100, paidById: u1.id,
    date: new Date().toISOString(), splitMode: "equal",
    shares: ids.map((id) => ({ userId: id, included: true })),
  });
  await u2.call("POST", `/groups/${gid}/expenses`, {
    title: "Cab", category: "Travel", amount: 40, paidById: u2.id,
    date: new Date().toISOString(), splitMode: "equal",
    shares: ids.map((id) => ({ userId: id, included: true })),
  });

  // Cross-check: the dedicated balances endpoint (uses computeBalances).
  const bal = await u1.call("GET", `/groups/${gid}/balances`);
  const expected = bal.data.myNet;

  // The batched list endpoint should report the same net.
  const list = await u1.call("GET", "/groups");
  const row = list.data.groups.find((g) => g.id === gid);
  ok(!!row, "group appears in list");
  ok(Math.abs(expected - 30) < 0.001, `balances endpoint net = 30 (got ${expected})`);
  ok(row && Math.abs(row.net - expected) < 0.001, `list net matches balances (${row?.net} vs ${expected})`);
} catch (e) {
  okAll = false;
  console.error("check-groups error:", e.message);
} finally {
  server.kill();
}
process.exitCode = okAll ? 0 : 1;
