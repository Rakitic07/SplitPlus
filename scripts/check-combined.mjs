// Non-destructive check for the combined /api/home and /api/groups/:id/bootstrap
// endpoints. Spins up its own users/group/expenses/settlement on a throwaway
// port and asserts the combined payloads match the individual endpoints.
import { spawn } from "node:child_process";

const PORT = process.env.CHECK_PORT || "8808";
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
  for (let i = 0; i < 80; i++) {
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
  const r1 = await u1.call("POST", "/auth/register", { name: `Cmb1_${uniq}`, passphrase: "passphrase1" });
  u1.set(r1.data.token, r1.data.user.id);
  const r2 = await u2.call("POST", "/auth/register", { name: `Cmb2_${uniq}`, passphrase: "passphrase1" });
  u2.set(r2.data.token, r2.data.user.id);

  const cg = await u1.call("POST", "/groups", {
    name: `CmbGrp_${uniq}`, currency: "INR", emoji: "🧮", inviteeIds: [u2.id],
  });
  const gid = cg.data.group.id;

  // u2 sees the invite via combined /home BEFORE accepting.
  const homeU2Pending = await u2.call("GET", "/home");
  ok(
    homeU2Pending.data.invites?.some((i) => i.group.id === gid),
    "/home surfaces the pending invite for u2"
  );

  const inv = await u2.call("GET", "/invites");
  const mine = inv.data.invites.find((i) => i.group.id === gid);
  await u2.call("POST", `/invites/${mine.id}`, { action: "accept" });

  const detail = await u1.call("GET", `/groups/${gid}`);
  const ids = detail.data.group.members.map((m) => m.id);

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

  // u1 records a settlement TO u2 → pending, so it lands in u2's incoming.
  await u1.call("POST", `/groups/${gid}/settlements`, { toId: u2.id, amount: 10, note: "test" });

  // ── /home parity (u1) ──────────────────────────────────────────────────
  const home = await u1.call("GET", "/home");
  const listGroups = await u1.call("GET", "/groups");
  ok(home.status === 200, "/home returns 200");
  const hRow = home.data.groups.find((g) => g.id === gid);
  const lRow = listGroups.data.groups.find((g) => g.id === gid);
  ok(!!hRow, "/home includes the group");
  ok(hRow && lRow && Math.abs(hRow.net - lRow.net) < 1e-6, `/home net matches /groups (${hRow?.net} vs ${lRow?.net})`);
  ok(home.data.invites.length === 0, "/home invites empty for u1 (owner)");

  // ── /home incoming settlement (u2) ─────────────────────────────────────
  const homeU2 = await u2.call("GET", "/home");
  ok(
    homeU2.data.settlements?.some((s) => s.groupId === gid && s.amount === 10),
    "/home surfaces u2's incoming pending settlement"
  );

  // ── /bootstrap parity (u1) vs the 5 individual endpoints ────────────────
  const boot = await u1.call("GET", `/groups/${gid}/bootstrap`);
  const [g, e, b, s, st] = await Promise.all([
    u1.call("GET", `/groups/${gid}`),
    u1.call("GET", `/groups/${gid}/expenses`),
    u1.call("GET", `/groups/${gid}/balances`),
    u1.call("GET", `/groups/${gid}/settlements`),
    u1.call("GET", `/groups/${gid}/stats`),
  ]);
  ok(boot.status === 200, "/bootstrap returns 200");
  ok(boot.data.group.members.length === g.data.group.members.length, "bootstrap.group matches /groups/:id");
  ok(boot.data.expenses.length === e.data.expenses.length && boot.data.expenses.length === 2, "bootstrap.expenses matches (2)");
  ok(Math.abs(boot.data.myNet - b.data.myNet) < 1e-6, `bootstrap.myNet matches /balances (${boot.data.myNet} vs ${b.data.myNet})`);
  ok(boot.data.balances.length === b.data.balances.length, "bootstrap.balances matches /balances");
  ok(boot.data.settlements.length === s.data.settlements.length && boot.data.settlements.length === 1, "bootstrap.settlements matches (1)");
  ok(boot.data.stats.basic.expenseCount === st.data.stats.basic.expenseCount, "bootstrap.stats matches /stats");
} catch (e) {
  okAll = false;
  console.error("check-combined error:", e.message);
} finally {
  server.kill();
}
process.exitCode = okAll ? 0 : 1;
