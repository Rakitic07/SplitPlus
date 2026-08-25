// Focused, non-destructive check: boots the API on a throwaway port and verifies
// GET /api/admin/metrics returns 200 with real totals (i.e. the $transaction
// batch doesn't blow the connection pool). Kills only the server it spawned.
import "./_guard-local.mjs"; // refuse to run unless targeting local SQLite
import { spawn } from "node:child_process";

const PORT = process.env.CHECK_PORT || "8801";
const BASE = `http://localhost:${PORT}/api`;
const ADMIN_SECRET = "check-metrics-secret";

const server = spawn("npx", ["tsx", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT, ADMIN_SECRET },
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

try {
  if (!(await up())) throw new Error("server never became healthy");
  const res = await fetch(`${BASE}/admin/metrics`, {
    headers: { "x-admin-secret": ADMIN_SECRET },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`metrics status ${res.status}: ${JSON.stringify(data)}`);
  const t = data.totals;
  console.log(`✓ metrics OK — users:${t.users} groups:${t.groups} expenses:${t.expenses} ` +
    `series:${data.series.expenses.length}d cats:${data.categories.length} sys:${data.system.node}`);
  const s = data.storage;
  if (!s) throw new Error("storage section missing from metrics payload");
  console.log(`✓ storage OK — provider:${s.provider} db:${s.dbBytes ?? "n/a"}B ` +
    `images:${s.attachments.totalCount} (${s.attachments.totalBytes}B) tables:${s.tables.length}`);
  const sy = data.system;
  console.log(`✓ system OK — mem(${sy.memBasis}):${sy.memUsedBytes}/${sy.memTotalBytes} ` +
    `cores:${sy.cpuCores} disk:${sy.diskTotalBytes ?? "n/a"}`);
} catch (e) {
  console.error("✗ metrics check failed:", e.message);
  process.exitCode = 1;
} finally {
  server.kill();
}
