// End-to-end smoke test for the new settings / invites / roles / stats features.
// Spawns the Express API (sqlite dev.db), exercises the flows, then shuts down.
import "./_guard-local.mjs"; // refuse to run unless targeting local SQLite
import { spawn } from "node:child_process";

const PORT = process.env.SMOKE_PORT || "8799";
const BASE = `http://localhost:${PORT}/api`;
let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

// A tiny fetch wrapper that carries a bearer token per "user".
function client() {
  let token = null;
  return {
    setToken: (t) => (token = t),
    getToken: () => token,
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
  };
}

async function waitForHealth(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const uniq = Date.now().toString(36);
const ADMIN_SECRET = "smoke-admin-secret-please-change";
const server = spawn("npx", ["tsx", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT, ADMIN_SECRET },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", (d) => process.env.SMOKE_DEBUG && console.error(String(d)));

try {
  const up = await waitForHealth();
  ok(up, "API is up");
  if (!up) throw new Error("server never became healthy");

  const A = client(); // owner
  const B = client(); // invitee → moderator
  const C = client(); // invitee → member
  const nameA = `Alpha_${uniq}`;
  const nameB = `Bravo_${uniq}`;
  const nameC = `Charlie_${uniq}`;

  // Register all three.
  for (const [c, name] of [[A, nameA], [B, nameB], [C, nameC]]) {
    const r = await c.call("POST", "/auth/register", { name, passphrase: "passphrase1" });
    c.setToken(r.data.token);
    ok(r.status === 201 && r.data.user?.defaultCurrency === "INR", `register ${name} (settings defaulted)`);
  }

  // Settings: A sets USD + weekly reminders.
  const setRes = await A.call("PATCH", "/auth/settings", {
    defaultCurrency: "USD",
    reminderEnabled: true,
    reminderFrequency: "weekly",
  });
  ok(setRes.status === 200 && setRes.data.user.defaultCurrency === "USD" && setRes.data.user.reminderEnabled === true, "A updates settings");

  const meRes = await A.call("GET", "/auth/me");
  ok(meRes.data.user?.defaultCurrency === "USD" && meRes.data.user?.reminderFrequency === "weekly", "me reflects settings");

  // Search min 3 chars.
  const s2 = await A.call("GET", `/auth/search?q=${nameB.slice(0, 2)}`);
  ok(s2.data.users.length === 0, "search ignores <3 chars");
  const s3 = await A.call("GET", `/auth/search?q=${nameB.slice(0, 5).toLowerCase()}`);
  const foundB = s3.data.users.find((u) => u.name === nameB);
  ok(!!foundB, "search finds by 3+ chars");

  // Look up B and C ids for create-with-invites.
  const idB = foundB.id;
  const s3c = await A.call("GET", `/auth/search?q=${nameC.slice(0, 5).toLowerCase()}`);
  const idC = s3c.data.users.find((u) => u.name === nameC).id;

  // Create group with invites in one step.
  const cg = await A.call("POST", "/groups", {
    name: `Trip_${uniq}`,
    currency: "USD",
    emoji: "🏖️",
    inviteeIds: [idB, idC],
  });
  ok(cg.status === 201 && cg.data.invited === 2, "create group sends 2 invites");
  const gid = cg.data.group.id;

  // B and C see the pending invite; they aren't members until they accept.
  const bInv = await B.call("GET", "/invites");
  const inviteForB = bInv.data.invites.find((i) => i.group.id === gid);
  ok(!!inviteForB, "B has a pending invite");
  const bBefore = await B.call("GET", `/groups/${gid}`);
  ok(bBefore.status === 404, "B can't see group before accepting (stays pending)");

  // Accept.
  const bAccept = await B.call("POST", `/invites/${inviteForB.id}`, { action: "accept" });
  ok(bAccept.status === 200, "B accepts invite");
  const cInv = await C.call("GET", "/invites");
  const inviteForC = cInv.data.invites.find((i) => i.group.id === gid);
  await C.call("POST", `/invites/${inviteForC.id}`, { action: "accept" });

  // Members can't invite; only owner/mod.
  const cInviteAttempt = await C.call("POST", `/groups/${gid}/invites`, { name: nameA });
  ok(cInviteAttempt.status === 403, "plain member cannot invite (403)");

  // Owner promotes B to moderator.
  const promo = await A.call("POST", `/groups/${gid}/members/${idB}/role`, { role: "moderator" });
  ok(promo.status === 200 && promo.data.role === "moderator", "owner promotes B to moderator");

  // Non-owner (C) cannot manage roles.
  const cRole = await C.call("POST", `/groups/${gid}/members/${idB}/role`, { role: "member" });
  ok(cRole.status === 403, "member cannot manage roles (403)");

  // Moderator B CAN now invite.
  const bInviteA = await B.call("POST", `/groups/${gid}/invites`, { name: "nobody_" + uniq });
  ok(bInviteA.status === 404, "moderator invite reaches lookup (no such user 404, not 403)");

  // Add an expense split equally among all three (owner pays).
  const gdetail = await A.call("GET", `/groups/${gid}`);
  const memberIds = gdetail.data.group.members.map((m) => m.id);
  ok(memberIds.length === 3, "group now has 3 members");
  const exp = await A.call("POST", `/groups/${gid}/expenses`, {
    title: "Hotel",
    category: "Travel",
    amount: 300,
    paidById: gdetail.data.group.myUserId,
    date: new Date().toISOString(),
    splitMode: "equal",
    shares: memberIds.map((id) => ({ userId: id, included: true })),
  });
  ok(exp.status === 201, "owner adds an expense");

  // Stats: owner sees advanced; member does not.
  const statsOwner = await A.call("GET", `/groups/${gid}/stats`);
  ok(statsOwner.data.stats.basic.totalSpent === 300, "stats basic totalSpent = 300");
  ok(!!statsOwner.data.stats.advanced, "owner sees advanced stats");
  ok(statsOwner.data.stats.advanced.perMember.length === 3, "advanced perMember covers 3 members");

  const statsMember = await C.call("GET", `/groups/${gid}/stats`);
  ok(statsMember.data.stats.basic.expenseCount === 1, "member sees basic stats");
  ok(statsMember.data.stats.advanced == null, "member does NOT see advanced stats");

  // Moderator B sees advanced too.
  const statsMod = await B.call("GET", `/groups/${gid}/stats`);
  ok(!!statsMod.data.stats.advanced, "moderator sees advanced stats");

  // ── Recovery flows ──────────────────────────────────────────────────────
  // 1. Recovery-code path: register D, then reset with the one-time code.
  const D = client();
  const nameD = `Delta_${uniq}`;
  const regD = await D.call("POST", "/auth/register", { name: nameD, passphrase: "passphrase1" });
  const codeD = regD.data.recoveryCode;
  ok(regD.status === 201 && typeof codeD === "string" && codeD.length > 0, "register D returns a recovery code");

  const badCode = await D.call("POST", "/auth/recover", {
    name: nameD,
    recoveryCode: "WRNG-WRNG-WRNG-WRNG",
    passphrase: "newpass1",
  });
  ok(badCode.status === 401, "recover rejects a wrong code (401)");

  const goodCode = await D.call("POST", "/auth/recover", {
    name: nameD,
    recoveryCode: codeD,
    passphrase: "newpass1",
  });
  ok(goodCode.status === 200 && !!goodCode.data.recoveryCode && goodCode.data.recoveryCode !== codeD, "recover with code resets + rotates code");
  const loginD = await D.call("POST", "/auth/login", { name: nameD, passphrase: "newpass1" });
  ok(loginD.status === 200, "D logs in with the new passphrase");

  // 2. Knowledge-based verify: A has a group + expense + co-members to match on.
  const badVerify = await A.call("POST", "/auth/reset-verify", {
    name: nameA,
    passphrase: "verified1",
    answers: { groupName: "totally wrong", expenseTitle: "nope" },
  });
  ok(badVerify.status === 401, "reset-verify rejects too few correct answers (401)");

  const goodVerify = await A.call("POST", "/auth/reset-verify", {
    name: nameA,
    passphrase: "verified1",
    answers: { groupName: `Trip_${uniq}`, expenseTitle: "Hotel", amount: "300", memberName: nameB },
  });
  ok(goodVerify.status === 200 && !!goodVerify.data.recoveryCode, "reset-verify succeeds with enough correct answers");
  const loginA2 = await A.call("POST", "/auth/login", { name: nameA, passphrase: "verified1" });
  ok(loginA2.status === 200, "A logs in with the verified new passphrase");

  // 3. Find-your-name: prefix lookup (min 3 chars).
  const findShort = await A.call("POST", "/auth/find", { query: "al" });
  ok(findShort.status === 400, "find rejects <3 chars (400)");
  const findOk = await A.call("POST", "/auth/find", { query: nameA.slice(0, 4).toLowerCase() });
  ok(findOk.status === 200 && findOk.data.matches.includes(nameA), "find returns matching name by prefix");

  // 4. Admin-approved reset: E requests, admin approves, E logs in with new pass.
  const E = client();
  const nameE = `Echo_${uniq}`;
  await E.call("POST", "/auth/register", { name: nameE, passphrase: "passphrase1" });

  const reqE = await E.call("POST", "/auth/reset-request", {
    name: nameE,
    passphrase: "adminset1",
    questionnaire: { groupName: "n/a", note: "please help" },
  });
  const ticketE = reqE.data.ticket;
  ok(reqE.status === 201 && typeof ticketE === "string" && ticketE.length > 0, "E submits an admin reset request (gets a ticket)");

  const stPending = await E.call("POST", "/auth/reset-status", { name: nameE, ticket: ticketE });
  ok(stPending.status === 200 && stPending.data.status === "pending", "reset-status is pending before approval");

  // Admin gate rejects a wrong secret.
  const admin = client();
  const badAdmin = await admin.call("GET", "/admin/reset-requests");
  ok(badAdmin.status === 401, "admin list rejects a missing secret (401)");

  // Correct secret via header (use a raw fetch to set x-admin-secret).
  const adminList = await fetch(`${BASE}/admin/reset-requests`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
  const reqForE = adminList.data.requests?.find((r) => r.user.name === nameE);
  ok(adminList.status === 200 && !!reqForE && reqForE.status === "pending", "admin lists E's pending request");

  const approve = await fetch(`${BASE}/admin/reset-requests/${reqForE.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET },
    body: JSON.stringify({ action: "approve" }),
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
  ok(approve.status === 200 && approve.data.status === "approved", "admin approves the request");

  const loginE = await E.call("POST", "/auth/login", { name: nameE, passphrase: "adminset1" });
  ok(loginE.status === 200, "E logs in with the admin-approved passphrase");

  const stApproved = await E.call("POST", "/auth/reset-status", { name: nameE, ticket: ticketE });
  ok(stApproved.data.status === "approved", "reset-status reflects approval");

  // ── Admin metrics dashboard ───────────────────────────────────────────────
  const noSecretMetrics = await admin.call("GET", "/admin/metrics");
  ok(noSecretMetrics.status === 401, "admin metrics rejects missing secret (401)");

  const metrics = await fetch(`${BASE}/admin/metrics`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
  const md = metrics.data;
  if (metrics.status !== 200) console.log("   metrics response:", JSON.stringify(metrics).slice(0, 400));
  ok(metrics.status === 200 && md.totals?.users >= 5, "metrics: totals.users counts registered users");
  ok(md.totals.groups >= 1 && md.totals.expenses >= 1, "metrics: groups & expenses counted");
  ok(md.totals.grandTotal >= 300, "metrics: grandTotal sums expense amounts");
  ok(Array.isArray(md.categories) && md.categories.some((c) => c.category === "Travel"), "metrics: top categories include Travel");
  ok(Array.isArray(md.series?.expenses) && md.series.expenses.length === 14, "metrics: 14-day expense series");
  ok(md.topPayers?.length >= 1 && md.topGroups?.length >= 1, "metrics: top payers & groups resolved");
  ok(md.recovery && typeof md.recovery.approved === "number", "metrics: recovery breakdown present");
  ok(md.system && typeof md.system.node === "string", "metrics: system/runtime stats present");

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.error("smoke error:", e);
  fail++;
} finally {
  server.kill("SIGKILL");
}
process.exit(fail === 0 ? 0 : 1);
