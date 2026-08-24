// Seeds the local dev DB with a small, realistic demo (groups, members, expenses)
// so the homepage looks alive for the README screenshot. Idempotent-ish: it skips
// group creation if the demo user already has groups.
//
// Requires the dev API to be running (npm run dev → API on :8787).
const BASE = process.env.SEED_BASE || "http://localhost:8787/api";
const PASS = "splitplus";

function client() {
  let token = null;
  return {
    id: null,
    setToken: (t) => (token = t),
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

// Register, or log in if the name already exists. Returns a token-bearing client
// with its user id set.
async function ensureUser(name) {
  const c = client();
  let r = await c.call("POST", "/auth/register", { name, passphrase: PASS });
  if (r.status !== 201) {
    r = await c.call("POST", "/auth/login", { name, passphrase: PASS });
  }
  if (!r.data?.token) throw new Error(`Could not auth ${name}: ${JSON.stringify(r.data)}`);
  c.setToken(r.data.token);
  c.id = r.data.user.id;
  return c;
}

async function createGroup(owner, { name, currency, emoji, inviteeIds }) {
  const r = await owner.call("POST", "/groups", { name, currency, emoji, inviteeIds });
  if (r.status !== 201) throw new Error(`create group failed: ${JSON.stringify(r.data)}`);
  return r.data.group.id;
}

async function acceptInvite(user, groupId) {
  const inv = await user.call("GET", "/invites");
  const mine = inv.data.invites?.find((i) => i.group.id === groupId);
  if (mine) await user.call("POST", `/invites/${mine.id}`, { action: "accept" });
}

async function addExpense(payer, groupId, { title, category, amount, memberIds }) {
  const r = await payer.call("POST", `/groups/${groupId}/expenses`, {
    title,
    category,
    amount,
    paidById: payer.id,
    date: new Date().toISOString(),
    splitMode: "equal",
    shares: memberIds.map((id) => ({ userId: id, included: true })),
  });
  if (r.status !== 201) throw new Error(`add expense "${title}" failed: ${JSON.stringify(r.data)}`);
}

async function main() {
  // Demo cast — "Raktim" is the account we log into for the screenshot.
  const raktim = await ensureUser("Raktim");
  const priya = await ensureUser("Priya");
  const kabir = await ensureUser("Kabir");
  const meera = await ensureUser("Meera");

  // Turn on weekly settle-up reminders so the banner shows in the screenshot.
  await raktim.call("PATCH", "/auth/settings", {
    defaultCurrency: "INR",
    reminderEnabled: true,
    reminderFrequency: "weekly",
  });

  const existing = await raktim.call("GET", "/groups");
  if ((existing.data.groups?.length ?? 0) >= 4) {
    console.log("Demo data already present — skipping group creation.");
    console.log(`\nLogin for screenshot →  name: Raktim   passphrase: ${PASS}\n`);
    return;
  }

  // 1) Goa Trip — Raktim is owed overall.
  const goa = await createGroup(raktim, {
    name: "Goa Trip",
    currency: "INR",
    emoji: "🏖️",
    inviteeIds: [priya.id, kabir.id],
  });
  await acceptInvite(priya, goa);
  await acceptInvite(kabir, goa);
  {
    const g = await raktim.call("GET", `/groups/${goa}`);
    const ids = g.data.group.members.map((m) => m.id);
    await addExpense(raktim, goa, { title: "Flights", category: "Travel", amount: 18000, memberIds: ids });
    await addExpense(priya, goa, { title: "Resort", category: "Stay", amount: 9000, memberIds: ids });
    await addExpense(kabir, goa, { title: "Beach shack dinner", category: "Food", amount: 3600, memberIds: ids });
  }

  // 2) Flat 303 — Raktim owes overall.
  const flat = await createGroup(raktim, {
    name: "Flat 303",
    currency: "INR",
    emoji: "🏠",
    inviteeIds: [meera.id],
  });
  await acceptInvite(meera, flat);
  {
    const g = await raktim.call("GET", `/groups/${flat}`);
    const ids = g.data.group.members.map((m) => m.id);
    await addExpense(meera, flat, { title: "October rent", category: "Rent", amount: 30000, memberIds: ids });
    await addExpense(raktim, flat, { title: "Wifi", category: "Utilities", amount: 1200, memberIds: ids });
  }

  // 3) Weekend Brunch — settled up (both paid equally).
  const brunch = await createGroup(raktim, {
    name: "Weekend Brunch",
    currency: "INR",
    emoji: "🥞",
    inviteeIds: [priya.id],
  });
  await acceptInvite(priya, brunch);
  {
    const g = await raktim.call("GET", `/groups/${brunch}`);
    const ids = g.data.group.members.map((m) => m.id);
    await addExpense(raktim, brunch, { title: "Coffee", category: "Food", amount: 800, memberIds: ids });
    await addExpense(priya, brunch, { title: "Pancakes", category: "Food", amount: 800, memberIds: ids });
  }

  // 4) Office Lunch — 4 members, Raktim owes a little.
  const office = await createGroup(raktim, {
    name: "Office Lunch",
    currency: "INR",
    emoji: "🍱",
    inviteeIds: [priya.id, kabir.id, meera.id],
  });
  await acceptInvite(priya, office);
  await acceptInvite(kabir, office);
  await acceptInvite(meera, office);
  {
    const g = await raktim.call("GET", `/groups/${office}`);
    const ids = g.data.group.members.map((m) => m.id);
    await addExpense(kabir, office, { title: "Team lunch", category: "Food", amount: 4800, memberIds: ids });
  }

  console.log("Seeded 4 demo groups with expenses.");
  console.log(`\nLogin for screenshot →  name: Raktim   passphrase: ${PASS}\n`);
}

main().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
