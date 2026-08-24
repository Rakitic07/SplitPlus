import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodError } from "zod";
import { getActiveUser, type Session } from "./auth.js";
import { prisma } from "./prisma.js";

export type MemberRole = "owner" | "moderator" | "member";

// A request that has passed requireAuth (session guaranteed present).
export interface AuthedRequest extends Request {
  session: Session;
  membershipRole?: MemberRole;
}

// Owners and moderators can manage the group (invite, edit, see advanced stats).
export function isElevated(role?: MemberRole): boolean {
  return role === "owner" || role === "moderator";
}

// Wrap an async handler so thrown errors become a clean 500 instead of an
// unhandled promise rejection.
export function ah(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req as AuthedRequest, res, next).catch((err) => {
      console.error("API error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Something went wrong. Please try again." });
      }
    });
  };
}

// Turn a zod error into a single friendly message.
export function zodMessage(err: ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

// Middleware: require a valid session (verified + user exists).
export const requireAuth: RequestHandler = (req, res, next) => {
  getActiveUser(req)
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      (req as AuthedRequest).session = session;
      next();
    })
    .catch((err) => {
      console.error("auth error:", err);
      res.status(503).json({ error: "Couldn't verify your session. Try again." });
    });
};

// Middleware factory: require the session user to be a member of :groupId.
export function requireMember(param = "groupId"): RequestHandler {
  return (req, res, next) => {
    const r = req as AuthedRequest;
    const groupId = req.params[param];
    prisma.membership
      .findUnique({
        where: { groupId_userId: { groupId, userId: r.session.userId } },
        select: { role: true },
      })
      .then((m) => {
        if (!m) {
          // 404 (not 403) so we never reveal that a group the user can't see exists.
          res.status(404).json({ error: "Group not found" });
          return;
        }
        r.membershipRole = m.role as MemberRole;
        next();
      })
      .catch((err) => {
        console.error("membership check error:", err);
        res.status(503).json({ error: "Couldn't reach the database. Try again." });
      });
  };
}
