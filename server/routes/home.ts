import { Router } from "express";
import { ah, requireAuth, type AuthedRequest } from "../lib/http.js";
import { listGroupsFor } from "./groups.js";
import { pendingInvitesFor } from "./invites.js";
import { incomingSettlementsFor } from "./settlements.js";

// Mounted at /api.
export const homeRouter = Router();

// GET /api/home — the whole dashboard in ONE round-trip: the user's groups
// (with their net), pending invites, and settlements awaiting their approval.
// The home page used to fire three separate requests; on a remote Postgres each
// is its own serverless invocation + connection acquisition, so collapsing them
// into a single call is a big cold-start win. Queries run sequentially to stay
// friendly to a connection_limit=1 pool.
homeRouter.get(
  "/home",
  requireAuth,
  ah(async (req, res) => {
    const me = (req as AuthedRequest).session.userId;
    const groups = await listGroupsFor(me);
    const invites = await pendingInvitesFor(me);
    const settlements = await incomingSettlementsFor(me);
    return res.json({ groups, invites, settlements });
  })
);
