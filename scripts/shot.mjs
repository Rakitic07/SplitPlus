// Logs into the running dev app as the demo user and screenshots the homepage
// into docs/homepage.png (for the README). Requires `npm run dev` running and
// `node scripts/seed-demo.mjs` to have been run first.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const WEB = process.env.SHOT_URL || "http://localhost:5173";
const OUT = process.env.SHOT_OUT || "docs/homepage.png";

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto(WEB, { waitUntil: "networkidle" });

  // Sign in as the seeded demo account (login is the default tab).
  await page.getByPlaceholder("e.g. Raktim").fill("Raktim");
  await page.getByPlaceholder("••••••••").fill("splitplus");
  await page.locator('button[type="submit"]').click();

  // Wait for the dashboard to render its group cards.
  await page.waitForSelector('a[href^="/g/"]', { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  // Let framer-motion entrance animations settle.
  await page.waitForTimeout(1400);

  await mkdir("docs", { recursive: true });
  await page.screenshot({ path: OUT, fullPage: true });
  console.log(`Saved ${OUT}`);
} finally {
  await browser.close();
}
