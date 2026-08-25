// Cleans the LOCAL dev database of the test / demo / seed junk that smoke.mjs,
// the check-*.mjs scripts and seed-demo.mjs leave behind (Alpha_*, Trip_*, Goa
// Trip, …) so the admin dashboard reflects genuine data.
//
// Modes:
//   node scripts/reset-db.mjs --all      wipe EVERYTHING (clean slate)
//   node scripts/reset-db.mjs --test     remove only test/demo records, keep the
//                                        accounts listed in KEEP (+ their groups)
//
// SAFETY: talks DIRECTLY to the local SQLite file (prisma/dev.db) via the sqlite3
// CLI, so it can NEVER touch the production Postgres DB — even though the Prisma
// client is generated for Postgres and .env points DATABASE_URL at Neon.
// Add --yes to actually apply; otherwise it just prints what it would do.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = resolve(__dirname, "..", "prisma", "dev.db");

function sql(query) {
  return execFileSync("sqlite3", [DB, query], { encoding: "utf8" });
}
function scalar(query) {
  return sql(query).trim();
}

function counts() {
  return {
    users: Number(scalar("SELECT COUNT(*) FROM User;")),
    groups: Number(scalar('SELECT COUNT(*) FROM "Group";')),
    expenses: Number(scalar("SELECT COUNT(*) FROM Expense;")),
    settlements: Number(scalar("SELECT COUNT(*) FROM Settlement;")),
  };
}

// Accounts to preserve in --test mode (case-insensitive, exact match).
const KEEP = ["Rak", "Rakitic", "QWE"];
const keepList = KEEP.map((n) => `'${n.toLowerCase()}'`).join(",");

// Test/demo user name patterns (LIKE, lower-cased) + explicit demo names.
const TEST_LIKE = ["alpha\\_%", "bravo\\_%", "charlie\\_%", "delta\\_%", "echo\\_%", "seek\\_%", "exp\\_%", "cmb%", "nobody\\_%"];
const DEMO_NAMES = ["priya", "kabir", "meera", "aarav", "raktim"];

// SQL predicate (on User row `u`) that is TRUE for junk users.
function junkUserPredicate() {
  const likes = TEST_LIKE.map((p) => `lower(name) LIKE '${p}' ESCAPE '\\'`).join(" OR ");
  const demos = DEMO_NAMES.map((n) => `'${n}'`).join(",");
  return `(lower(name) NOT IN (${keepList}) AND ((${likes}) OR lower(name) IN (${demos})))`;
}

function wipeAll() {
  // Children first (several creator/payer relations have no cascade).
  const stmts = [
    "PRAGMA foreign_keys=OFF;",
    "DELETE FROM ExpenseShare;",
    "DELETE FROM Expense;",
    "DELETE FROM Settlement;",
    "DELETE FROM Invite;",
    "DELETE FROM Membership;",
    "DELETE FROM ResetRequest;",
    'DELETE FROM "Group";',
    "DELETE FROM User;",
  ];
  sql(stmts.join("\n"));
}

function wipeTest() {
  const junk = junkUserPredicate();
  // Junk group = test/demo-named OR created by a junk user.
  const junkGroup =
    `id IN (SELECT g.id FROM "Group" g WHERE ` +
    `lower(g.name) LIKE 'trip\\_%' ESCAPE '\\' ` +
    `OR lower(g.name) IN ('goa trip','flat 303','weekend brunch','office lunch') ` +
    `OR g.createdById IN (SELECT id FROM User u WHERE ${junk}))`;

  const stmts = [
    "PRAGMA foreign_keys=OFF;",
    // 1) Drop junk groups + everything inside them.
    `DELETE FROM ExpenseShare WHERE expenseId IN (SELECT id FROM Expense WHERE groupId IN (SELECT id FROM "Group" WHERE ${junkGroup}));`,
    `DELETE FROM Expense WHERE groupId IN (SELECT id FROM "Group" WHERE ${junkGroup});`,
    `DELETE FROM Settlement WHERE groupId IN (SELECT id FROM "Group" WHERE ${junkGroup});`,
    `DELETE FROM Invite WHERE groupId IN (SELECT id FROM "Group" WHERE ${junkGroup});`,
    `DELETE FROM Membership WHERE groupId IN (SELECT id FROM "Group" WHERE ${junkGroup});`,
    `DELETE FROM "Group" WHERE ${junkGroup};`,
    // 2) Clear refs to junk users that survive in KEPT groups, then delete them.
    `DELETE FROM ExpenseShare WHERE userId IN (SELECT id FROM User u WHERE ${junk});`,
    `DELETE FROM Expense WHERE paidById IN (SELECT id FROM User u WHERE ${junk}) OR createdById IN (SELECT id FROM User u WHERE ${junk});`,
    `DELETE FROM Settlement WHERE fromId IN (SELECT id FROM User u WHERE ${junk}) OR toId IN (SELECT id FROM User u WHERE ${junk});`,
    `DELETE FROM Invite WHERE inviteeId IN (SELECT id FROM User u WHERE ${junk}) OR invitedById IN (SELECT id FROM User u WHERE ${junk});`,
    `DELETE FROM Membership WHERE userId IN (SELECT id FROM User u WHERE ${junk});`,
    `DELETE FROM ResetRequest WHERE userId IN (SELECT id FROM User u WHERE ${junk});`,
    `DELETE FROM User u WHERE ${junk};`,
  ];
  sql(stmts.join("\n"));
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--all") ? "all" : args.includes("--test") ? "test" : null;
  if (!mode) {
    console.error("Usage: node scripts/reset-db.mjs --all | --test  [--yes]");
    process.exit(1);
  }
  if (!existsSync(DB)) {
    console.error(`No local dev DB at ${DB} — nothing to clean.`);
    process.exit(1);
  }

  console.log(`\n  DB:     ${DB}`);
  console.log("  Before:", counts());
  console.log(`  Mode:   ${mode === "all" ? "FULL WIPE (everything)" : "remove test/demo only (keep " + KEEP.join(", ") + ")"}`);

  if (!args.includes("--yes")) {
    console.log("\n  Dry run — add --yes to actually apply. Nothing changed.\n");
    return;
  }

  if (mode === "all") wipeAll();
  else wipeTest();

  console.log("  After: ", counts(), "\n  Done.\n");
}

main();
