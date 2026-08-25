// Generates a 1200x630 social-share card (public/og-image.png) so link previews
// on WhatsApp / iMessage / Slack / Twitter show the branded Split+ card instead
// of nothing. Run: node scripts/og.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public/og-image.png");

const logo = `
<svg width="150" height="150" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Split+">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8a3d"/><stop offset="0.55" stop-color="#ffab33"/><stop offset="1" stop-color="#ffc23d"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#fill)"/>
  <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#shine)"/>
  <g stroke="#ffffff" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 25 H40"/><path d="M34 19 L42 25 L34 31"/>
    <path d="M45 39 H24"/><path d="M30 33 L22 39 L30 45"/>
  </g>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
  * { margin:0; box-sizing:border-box; }
  body { width:1200px; height:630px; overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#0a0807; color:#fff; position:relative; }
  .glow1 { position:absolute; width:620px; height:620px; border-radius:50%; top:-200px; right:-140px;
    background:radial-gradient(circle,#ff8a3d55,transparent 62%); filter:blur(20px); }
  .glow2 { position:absolute; width:520px; height:520px; border-radius:50%; bottom:-220px; left:-120px;
    background:radial-gradient(circle,#ffc23d33,transparent 62%); filter:blur(20px); }
  .wrap { position:relative; height:100%; display:flex; flex-direction:column; justify-content:center; padding:0 96px; gap:26px; }
  .top { display:flex; align-items:center; gap:26px; }
  .word { font-size:96px; font-weight:900; letter-spacing:-2px;
    background:linear-gradient(120deg,#ff8a3d,#ffab33,#ffc23d); -webkit-background-clip:text; background-clip:text; color:transparent; }
  h1 { font-size:58px; font-weight:800; line-height:1.05; letter-spacing:-1px; max-width:940px; }
  p { font-size:30px; color:#b8b0a8; max-width:900px; line-height:1.35; }
  .chips { display:flex; gap:14px; margin-top:8px; }
  .chip { border:1px solid #ffffff22; background:#ffffff0d; border-radius:999px; padding:12px 22px; font-size:24px; font-weight:600; color:#e9e2da; }
  .host { position:absolute; bottom:52px; left:96px; font-size:26px; font-weight:700; color:#ff9f43; }
</style></head><body>
  <div class="glow1"></div><div class="glow2"></div>
  <div class="wrap">
    <div class="top">${logo}<span class="word">Split+</span></div>
    <h1>Split expenses, beautifully.</h1>
    <p>Create groups, split bills any way you like, and settle up with confirmation.</p>
    <div class="chips"><span class="chip">Groups &amp; invites</span><span class="chip">Any split</span><span class="chip">Charts &amp; export</span></div>
  </div>
  <div class="host">split-plus.vercel.app</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: OUT, type: "png" });
await browser.close();
console.log("Wrote", OUT);
