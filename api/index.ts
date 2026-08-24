// Vercel serverless entry: it re-exports the Express app as the request handler.
// vercel.json rewrites every /api/* request to this function, and Express routes
// them exactly as it does in local dev.
import app from "../server/app.js";

export default app;
