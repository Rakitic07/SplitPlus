// Import this FIRST in any script that spawns the API / writes test data. It
// aborts unless the generated Prisma client targets the LOCAL SQLite DB, so a
// stray `prisma generate` (Postgres) can never let test/seed scripts pollute
// production again.
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const provider = p._activeProvider;
await p.$disconnect();

if (provider !== "sqlite") {
  console.error(
    `\n  ✗ Prisma client is generated for "${provider}", not sqlite.\n` +
      `    Refusing to run test/seed scripts against a non-local database.\n` +
      `    Fix: npm run predev   (regenerates the local SQLite client) and retry.\n`
  );
  process.exit(1);
}
