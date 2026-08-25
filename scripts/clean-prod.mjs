// Removes test/script-generated junk from the database the Prisma client is
// generated for — intended for the PRODUCTION Postgres (Neon) that got polluted
// when smoke/check scripts ran against a Postgres-generated client.
//
// It keeps ONLY the accounts you name and deletes every other user plus any
// group they own, in FK-safe order.
//
//   node scripts/clean-prod.mjs --keep "Rak,Teen Bandar"            # dry run
//   node scripts/clean-prod.mjs --keep "Rak,Teen Bandar" --prod --yes   # apply
//
// SAFETY: writes only run with BOTH --prod and --yes. Without them it just prints
// the plan. --prod also asserts the active provider is postgresql so you don't
// accidentally aim a "prod" clean at the wrong datasource.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const keepRaw = arg("--keep");
  if (!keepRaw) {
    console.error('Usage: node scripts/clean-prod.mjs --keep "Name1,Name2" [--prod --yes]');
    process.exit(1);
  }
  const keep = keepRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const apply = process.argv.includes("--prod") && process.argv.includes("--yes");

  const provider = prisma._activeProvider;
  console.log("\n  provider:", provider);
  if (process.argv.includes("--prod") && provider !== "postgresql") {
    console.error(`  ✗ --prod expects postgresql, but active provider is "${provider}". Aborting.`);
    process.exit(1);
  }

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const groups = await prisma.group.findMany({ select: { id: true, name: true, createdById: true } });

  const junkUsers = users.filter((u) => !keep.includes(u.name.toLowerCase()));
  const keepUserIds = new Set(users.filter((u) => keep.includes(u.name.toLowerCase())).map((u) => u.id));
  const junkUserIds = junkUsers.map((u) => u.id);
  const junkGroups = groups.filter((g) => !keepUserIds.has(g.createdById));
  const junkGroupIds = junkGroups.map((g) => g.id);

  console.log(`  keep accounts: ${keep.join(", ")}`);
  console.log(`\n  Will DELETE ${junkUsers.length} users:`);
  console.log("   ", junkUsers.map((u) => u.name).join(", ") || "(none)");
  console.log(`\n  Will DELETE ${junkGroups.length} groups:`);
  console.log("   ", junkGroups.map((g) => g.name).join(", ") || "(none)");
  const keptUsers = users.filter((u) => keepUserIds.has(u.id));
  const keptGroups = groups.filter((g) => keepUserIds.has(g.createdById));
  console.log(`\n  Will KEEP ${keptUsers.length} users: ${keptUsers.map((u) => u.name).join(", ")}`);
  console.log(`  Will KEEP ${keptGroups.length} groups: ${keptGroups.map((g) => g.name).join(", ")}`);

  if (!apply) {
    console.log("\n  Dry run — add --prod --yes to apply. Nothing changed.\n");
    await prisma.$disconnect();
    return;
  }

  const gIn = { in: junkGroupIds };
  const uIn = { in: junkUserIds };

  // 1) Junk groups + everything inside them (explicit, in child→parent order so
  //    we don't depend on cascade being configured).
  if (junkGroupIds.length) {
    await prisma.expenseShare.deleteMany({ where: { expense: { groupId: gIn } } });
    await prisma.expense.deleteMany({ where: { groupId: gIn } });
    await prisma.settlement.deleteMany({ where: { groupId: gIn } });
    await prisma.invite.deleteMany({ where: { groupId: gIn } });
    await prisma.membership.deleteMany({ where: { groupId: gIn } });
    await prisma.group.deleteMany({ where: { id: gIn } });
  }

  // 2) Remove junk-user references that survive inside KEPT groups, then the
  //    users themselves.
  if (junkUserIds.length) {
    await prisma.expenseShare.deleteMany({ where: { userId: uIn } });
    await prisma.expense.deleteMany({ where: { OR: [{ paidById: uIn }, { createdById: uIn }] } });
    await prisma.settlement.deleteMany({ where: { OR: [{ fromId: uIn }, { toId: uIn }] } });
    await prisma.invite.deleteMany({ where: { OR: [{ inviteeId: uIn }, { invitedById: uIn }] } });
    await prisma.membership.deleteMany({ where: { userId: uIn } });
    await prisma.resetRequest.deleteMany({ where: { userId: uIn } });
    await prisma.user.deleteMany({ where: { id: uIn } });
  }

  const [users2, groups2, expenses2] = await prisma.$transaction([
    prisma.user.count(),
    prisma.group.count(),
    prisma.expense.count(),
  ]);
  console.log("\n  After:", { users: users2, groups: groups2, expenses: expenses2 }, "\n  Done.\n");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("clean-prod failed:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
