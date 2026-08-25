// READ-ONLY inspection of whatever database the Prisma client is generated for
// (locally that's SQLite; after a production build it's the Neon Postgres in
// DATABASE_URL). Prints provider + counts + user/group names so we can tell real
// data apart from test/demo junk. Makes NO writes.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("provider:", prisma._activeProvider);

  const [users, groups, expenses, settlements, invites, resets] = await prisma.$transaction([
    prisma.user.count(),
    prisma.group.count(),
    prisma.expense.count(),
    prisma.settlement.count(),
    prisma.invite.count(),
    prisma.resetRequest.count(),
  ]);
  console.log("counts:", { users, groups, expenses, settlements, invites, resets });

  const us = await prisma.user.findMany({
    select: { id: true, name: true, createdAt: true, _count: { select: { memberships: true, createdGroups: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nUSERS (name | groups-created | memberships | created):");
  for (const u of us) {
    console.log(
      `  ${u.name}  |  cg=${u._count.createdGroups}  mem=${u._count.memberships}  |  ${u.createdAt.toISOString().slice(0, 10)}`
    );
  }

  const gs = await prisma.group.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      _count: { select: { members: true, expenses: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nGROUPS (name | owner | members | expenses | created):");
  for (const g of gs) {
    console.log(
      `  ${g.name}  |  by ${g.createdBy?.name ?? "?"}  |  m=${g._count.members} e=${g._count.expenses}  |  ${g.createdAt
        .toISOString()
        .slice(0, 10)}`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("inspect failed:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
