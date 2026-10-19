import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ah } from "../lib/http.js";
import { decodeImage } from "../lib/images.js";

// Mounted at /api.
export const imgRouter = Router();

// GET /api/img/:kind/:id/:ver — an avatar (u) or group cover (g). No session
// needed: the URL embeds the image's content hash, so it can't be guessed
// without already having the image, and it never changes (cache forever).
imgRouter.get(
  "/img/:kind/:id/:ver",
  ah(async (req, res) => {
    const { kind, id, ver } = req.params;
    let row: { data: string | null; ver: string | null } | null = null;
    if (kind === "u") {
      const u = await prisma.user.findUnique({
        where: { id },
        select: { avatar: true, avatarVer: true },
      });
      row = u && { data: u.avatar, ver: u.avatarVer };
    } else if (kind === "g") {
      const g = await prisma.group.findUnique({
        where: { id },
        select: { thumbnail: true, thumbVer: true },
      });
      row = g && { data: g.thumbnail, ver: g.thumbVer };
    }

    const img = row?.data && row.ver === ver ? decodeImage(row.data) : null;
    if (!img) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "Not found" });
    }
    res.setHeader("Content-Type", img.mime);
    res.setHeader("Content-Length", String(img.bytes.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    return res.end(img.bytes);
  })
);
