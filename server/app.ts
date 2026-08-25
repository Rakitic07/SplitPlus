import express from "express";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { groupsRouter } from "./routes/groups.js";
import { invitesRouter } from "./routes/invites.js";
import { expensesRouter } from "./routes/expenses.js";
import { settlementsRouter } from "./routes/settlements.js";
import { adminRouter } from "./routes/admin.js";
import { homeRouter } from "./routes/home.js";
import { searchRouter } from "./routes/search.js";
import { versionRouter } from "./routes/version.js";

const app = express();

// Base64 receipt/avatar thumbnails ride inside the JSON body, so allow a few MB.
app.use(express.json({ limit: "4mb" }));

// Health check that ALSO issues a trivial DB query. Point an external uptime
// pinger (e.g. cron-job.org / UptimeRobot) at this every ~3-4 min so the
// serverless function AND the Neon compute stay warm — this is what kills the
// 3-5s "scale-to-zero" cold start users feel on the first load after idle.
app.get("/api/health", async (_req, res) => {
  const t0 = Date.now();
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  res.json({
    ok: true,
    service: "split-plus",
    db,
    dbMs: Date.now() - t0,
    time: new Date().toISOString(),
  });
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api", homeRouter);
app.use("/api", searchRouter);
app.use("/api", versionRouter);
app.use("/api/groups", groupsRouter);
// These routers declare full `/groups/:groupId/...` (and `/invites`, `/settlements`)
// paths, so they mount at the /api root.
app.use("/api", invitesRouter);
app.use("/api", expensesRouter);
app.use("/api", settlementsRouter);

// Anything else under /api is a real 404 (never fall through to the SPA).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
