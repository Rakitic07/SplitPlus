import { Router } from "express";
import { ah } from "../lib/http.js";
import { verifyBanner } from "../lib/ntfy.js";
import { renderBanner } from "../lib/banner.js";

// Mounted at /api.
export const ntfyRouter = Router();

// GET /api/ntfy/banner/:data/:sig.png — the notification image. No session:
// the phone's ntfy app fetches it directly, so the URL is HMAC-signed instead.
ntfyRouter.get(
  "/ntfy/banner/:data/:sig.png",
  ah(async (req, res) => {
    const payload = verifyBanner(req.params.data, req.params.sig);
    const png = payload ? await renderBanner(payload) : null;
    if (!png) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "Not found" });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(png);
  })
);
