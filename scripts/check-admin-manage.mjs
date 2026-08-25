// Non-destructive check for admin user/group management: list, rename (with
// uniqueness), edit group, and cascade deletes. Runs on a throwaway port
// against local SQLite.
import "./_guard-local.mjs"; // refuse to run unless targeting local SQLite
import { spawn } from "node:child_process";

const PORT = process.env.CHECK_PORT || "8805";
const BASE = `http://localhost:${PORT}/api`;
const SECRET = "adm_secret_" + Date.now().toString(36);
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

// Admin call with the secret header; pass secret=null to test the gate.
async function admin(method, path, body, secret = SECRET) {
  const headers = {};
  if (secret) headers["x-admin-secret"] = secret;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const server = spawn("npx", ["tsx", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT, ADMIN_SECRET: SECRET },
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
  const ra = await a.call("POST", "/auth/register", { name: `Adm_${uniq}`, passphrase: "passphrase1" });
  a.set(ra.data.token, ra.data.user.id);
  const rb = await b.call("POST", "/auth/register", { name: `Bdm_${uniq}`, passphrase: "passphrase1" });
  b.set(rb.data.token, rb.data.user.id);

  // A owns a group with one expense.
  const cg = await a.call("POST", "/groups", { name: `Grp_${uniq}`, currency: "INR", emoji: "🏠" });
  const gid = cg.data.group.id;
  await a.call("POST", `/groups/${gid}/expenses`, {
    title: `Din_${uniq}`,
    category: "Food",
    amount: 120,
    paidById: a.id,
    date: new Date().toISOString(),
    splitMode: "equal",
    shares: [{ userId: a.id, included: true }],
  });

  // ── Gate ────────────────────────────────────────────────────────────
  const noSecret = await admin("GET", "/admin/users", null, null);
  ok(noSecret.status === 401, "admin routes require the secret (401 without)");

  // ── Users list ──────────────────────────────────────────────────────
  const ulist = await admin("GET", `/admin/users?q=${uniq}`);
  const uA = ulist.data.users?.find((u) => u.id === a.id);
  const uB = ulist.data.users?.find((u) => u.id === b.id);
  ok(ulist.status === 200 && !!uA && !!uB, "lists both users by search");
  ok(uA?.ownedGroups === 1 && uA?.paidExpenses === 1, `user counts are real (owned=${uA?.ownedGroups}, paid=${uA?.paidExpenses})`);

  // ── Rename user ─────────────────────────────────────────────────────
  const clash = await admin("PATCH", `/admin/users/${b.id}`, { name: `Adm_${uniq}` });
  ok(clash.status === 409, "cannot rename to an existing name (409)");
  const rename = await admin("PATCH", `/admin/users/${b.id}`, { name: `Bee_${uniq}` });
  ok(rename.status === 200 && rename.data.user.name === `Bee_${uniq}`, "renames a user");
  // The renamed user can no longer log in under the OLD name, but can under new.
  const relog = await b.call("POST", "/auth/login", { name: `Bee_${uniq}`, passphrase: "passphrase1" });
  ok(relog.status === 200, "renamed user logs in with the new name");

  // ── Groups list + edit ──────────────────────────────────────────────
  const glist = await admin("GET", `/admin/groups?q=${uniq}`);
  const gRow = glist.data.groups?.find((g) => g.id === gid);
  ok(glist.status === 200 && !!gRow, "lists the group by search");
  ok(gRow?.owner?.id === a.id && gRow?.expenses === 1 && gRow?.members === 1, `group meta is real (owner ok, exp=${gRow?.expenses}, mem=${gRow?.members})`);

  const gedit = await admin("PATCH", `/admin/groups/${gid}`, { name: `Grp2_${uniq}`, currency: "USD", emoji: "🎉" });
  ok(gedit.status === 200 && gedit.data.group.name === `Grp2_${uniq}` && gedit.data.group.currency === "USD" && gedit.data.group.emoji === "🎉", "edits group name/currency/emoji");

  const bad = await admin("PATCH", `/admin/groups/nope_${uniq}`, { name: "x" });
  ok(bad.status === 404, "editing a missing group → 404");

  // ── Delete user (cascades owned group) ──────────────────────────────
  const delU = await admin("DELETE", `/admin/users/${a.id}`);
  ok(delU.status === 200, "deletes the owner account");
  const afterU = await admin("GET", `/admin/users?q=${uniq}`);
  ok(!afterU.data.users?.some((u) => u.id === a.id), "deleted user no longer listed");
  const afterG = await admin("GET", `/admin/groups?q=${uniq}`);
  ok(!afterG.data.groups?.some((g) => g.id === gid), "owner's group was cascade-deleted with them");

  // ── Delete group directly ───────────────────────────────────────────
  const cg2 = await b.call("POST", "/groups", { name: `Solo_${uniq}`, currency: "INR", emoji: "🧾" });
  const gid2 = cg2.data.group.id;
  const delG = await admin("DELETE", `/admin/groups/${gid2}`);
  ok(delG.status === 200, "deletes a group directly");
  const afterG2 = await admin("GET", `/admin/groups?q=${uniq}`);
  ok(!afterG2.data.groups?.some((g) => g.id === gid2), "deleted group no longer listed");
  const delMissing = await admin("DELETE", `/admin/groups/${gid2}`);
  ok(delMissing.status === 404, "deleting a missing group → 404");
} catch (e) {
  okAll = false;
  console.error("check-admin-manage error:", e.message);
} finally {
  server.kill();
}
process.exitCode = okAll ? 0 : 1;
