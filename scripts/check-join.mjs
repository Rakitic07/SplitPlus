// Non-destructive check for the shareable group "join link" flow.
// Owner creates a group, fetches its join-link token, a brand-new user previews
// the group by token and then joins by token (no name-invite needed) and shows
// up as a member. Runs on a throwaway port against local SQLite.
import "./_guard-local.mjs"; // refuse to run unless targeting local SQLite
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

  const owner = client();
  const joiner = client();
  const ro = await owner.call("POST", "/auth/register", { name: `Own_${uniq}`, passphrase: "passphrase1" });
  owner.set(ro.data.token, ro.data.user.id);
  const rj = await joiner.call("POST", "/auth/register", { name: `Joi_${uniq}`, passphrase: "passphrase1" });
  joiner.set(rj.data.token, rj.data.user.id);

  const cg = await owner.call("POST", "/groups", { name: `Link_${uniq}`, currency: "INR", emoji: "🔗" });
  const gid = cg.data.group.id;

  // Owner fetches the shareable link token (created on demand).
  const link = await owner.call("GET", `/groups/${gid}/join-link`);
  ok(link.status === 200 && typeof link.data.token === "string" && link.data.token.length >= 16, `join-link token issued (${link.data.token?.length} chars)`);
  const token = link.data.token;

  // Stable: asking again returns the SAME token.
  const link2 = await owner.call("GET", `/groups/${gid}/join-link`);
  ok(link2.data.token === token, "join-link is stable across requests");

  // A non-member can PREVIEW by token (name + member count), nothing sensitive.
  const prev = await joiner.call("GET", `/join/${token}`);
  ok(prev.status === 200 && prev.data.group?.id === gid, "preview resolves the group by token");
  ok(prev.data.group?.memberCount === 1, `preview shows member count (${prev.data.group?.memberCount})`);

  // Before joining, the joiner cannot see the group detail.
  const denied = await joiner.call("GET", `/groups/${gid}`);
  ok(denied.status === 404, "non-member is denied group detail (404)");

  // Join by token.
  const join = await joiner.call("POST", `/join/${token}`);
  ok(join.status === 200 && join.data.groupId === gid && join.data.alreadyMember === false, "joiner joins via token");

  // Now the joiner is a member and can load the group.
  const detail = await joiner.call("GET", `/groups/${gid}`);
  ok(detail.status === 200 && detail.data.group.members.some((m) => m.id === joiner.id), "joiner now appears as a member");

  // Re-join is idempotent.
  const again = await joiner.call("POST", `/join/${token}`);
  ok(again.status === 200 && again.data.alreadyMember === true, "re-join is idempotent (alreadyMember)");

  // Group shows up in the joiner's dashboard.
  const home = await joiner.call("GET", "/home");
  ok(home.data.groups.some((g) => g.id === gid), "group appears on joiner's home");

  // Invalid token → 404 on both preview and join.
  const badPrev = await joiner.call("GET", `/join/nope_${uniq}`);
  ok(badPrev.status === 404, "invalid token preview → 404");
  const badJoin = await joiner.call("POST", `/join/nope_${uniq}`);
  ok(badJoin.status === 404, "invalid token join → 404");

  // Rotating the link invalidates the old token; a new one works.
  const rot = await owner.call("POST", `/groups/${gid}/join-link/rotate`);
  ok(rot.status === 200 && rot.data.token && rot.data.token !== token, "owner rotates the link token");
  const oldPrev = await joiner.call("GET", `/join/${token}`);
  ok(oldPrev.status === 404, "old token stops working after rotate");

  // A non-elevated member cannot rotate.
  const cannot = await joiner.call("POST", `/groups/${gid}/join-link/rotate`);
  ok(cannot.status === 403, "non-owner cannot rotate the link");
} catch (e) {
  okAll = false;
  console.error("check-join error:", e.message);
} finally {
  server.kill();
}
process.exitCode = okAll ? 0 : 1;
