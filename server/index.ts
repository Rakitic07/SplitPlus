import app from "./app.js";

// Local development server. In production on Vercel the same Express `app` is
// exported from api/index.ts as a serverless function instead (see vercel.json).
const PORT = Number(process.env.PORT) || 8787;

app.listen(PORT, () => {
  console.log(`\n  Split-Plus API  →  http://localhost:${PORT}/api/health\n`);
});
