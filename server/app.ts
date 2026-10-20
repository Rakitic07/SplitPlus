import express from "express";
import { authRouter } from "./routes/auth.js";
import { groupsRouter } from "./routes/groups.js";
import { invitesRouter } from "./routes/invites.js";
import { expensesRouter } from "./routes/expenses.js";
import { settlementsRouter } from "./routes/settlements.js";
import { adminRouter } from "./routes/admin.js";
import { homeRouter } from "./routes/home.js";
import { searchRouter } from "./routes/search.js";
import { versionRouter } from "./routes/version.js";
import { joinRouter } from "./routes/join.js";
import { imgRouter } from "./routes/img.js";
import { ntfyRouter } from "./routes/ntfy.js";
import { imageOrigin } from "./lib/images.js";
import { countRequests } from "./lib/usage.js";

const app = express();

// Base64 receipt/avatar thumbnails ride inside the JSON body, so allow a few MB.
app.use(express.json({ limit: "4mb" }));

// Keep-warm / uptime endpoint. It must never touch the database: pingers hit it
// every few minutes, and any query here would stop Neon's free-plan compute from
// ever scaling to zero (24/7 awake ≈ 186 CU-hours/month vs. the 100 included).
// Neon itself wakes in a few hundred ms on the first real query.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "split-plus", time: new Date().toISOString() });
});

app.use("/api", countRequests);
app.use("/api", imgRouter);
app.use("/api", ntfyRouter);
app.use("/api", imageOrigin);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api", homeRouter);
app.use("/api", searchRouter);
app.use("/api", versionRouter);
app.use("/api", joinRouter);
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
