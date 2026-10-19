import { parse, serialize } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";
import { prisma } from "./prisma.js";

const COOKIE_NAME = "splitplus_session";
// Native clients read refreshed tokens from this header (web uses the cookie).
export const SESSION_HEADER = "X-Session-Token";

const DAY_SECONDS = 60 * 60 * 24;

export type SessionPolicy = "6months" | "never";
export const SESSION_POLICIES: readonly SessionPolicy[] = ["6months", "never"];

// Token lifetime per policy. Tokens slide: every request made more than
// RENEW_AFTER_SECONDS after issue gets a fresh token, so "6months" means six
// months of NOT using the app, and "never" effectively never expires.
const TTL_SECONDS: Record<SessionPolicy, number> = {
  "6months": 180 * DAY_SECONDS,
  never: 3650 * DAY_SECONDS,
};
// Browsers cap cookie lifetimes at 400 days; renewal keeps pushing it forward.
const COOKIE_MAX_SECONDS = 400 * DAY_SECONDS;
const RENEW_AFTER_SECONDS = DAY_SECONDS;

export const asPolicy = (p: string | null | undefined): SessionPolicy =>
  p === "never" ? "never" : "6months";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is not set. Add a long random value to your environment."
    );
  }
  return new TextEncoder().encode(secret);
}

export type Session = { userId: string; name: string };
type Claims = Session & { sv: number; iat: number };

async function issue(
  res: Response,
  s: Session & { sv: number; policy: SessionPolicy }
): Promise<string> {
  const ttl = TTL_SECONDS[s.policy];
  const token = await new SignJWT({ userId: s.userId, name: s.name, sv: s.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getSecret());

  res.setHeader(
    "Set-Cookie",
    serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.min(ttl, COOKIE_MAX_SECONDS),
    })
  );
  res.setHeader(SESSION_HEADER, token);
  return token;
}

// Sign the session JWT, set it as an HttpOnly cookie (web) AND return it so the
// native app can persist it and send it via the Authorization header. The
// user's current session version and policy are read from the DB.
export async function createSession(res: Response, payload: Session): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { sessionVersion: true, sessionPolicy: true },
  });
  return issue(res, {
    ...payload,
    sv: user?.sessionVersion ?? 0,
    policy: asPolicy(user?.sessionPolicy),
  });
}

export function clearSession(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serialize(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
  );
}

async function readClaims(req: Request): Promise<Claims | null> {
  const authz = req.headers.authorization;
  const bearer =
    authz && authz.toLowerCase().startsWith("bearer ")
      ? authz.slice(7).trim()
      : null;

  const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
  // A stale Bearer copy must not shadow a still-valid cookie (web sends both).
  for (const token of [bearer, cookies[COOKIE_NAME]]) {
    if (!token) continue;
    try {
      const { payload } = await jwtVerify(token, getSecret());
      if (typeof payload.userId === "string" && typeof payload.name === "string") {
        return {
          userId: payload.userId,
          name: payload.name,
          // Tokens minted before session versions existed count as version 0.
          sv: typeof payload.sv === "number" ? payload.sv : 0,
          iat: typeof payload.iat === "number" ? payload.iat : 0,
        };
      }
    } catch {
      /* try the next token */
    }
  }
  return null;
}

// Verify the JWT from the Bearer header (native) or the cookie (web). Does NOT
// touch the DB — cheap, for endpoints that only need the id.
export async function readSession(req: Request): Promise<Session | null> {
  const c = await readClaims(req);
  return c ? { userId: c.userId, name: c.name } : null;
}

// Like readSession, but also confirms the user still exists and the token
// hasn't been revoked ("log out of all devices"). When `res` is given, a token
// older than a day is transparently renewed so active users never expire.
export async function getActiveUser(req: Request, res?: Response): Promise<Session | null> {
  const claims = await readClaims(req);
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, name: true, sessionVersion: true, sessionPolicy: true },
  });
  if (!user || user.sessionVersion !== claims.sv) return null;

  const session = { userId: user.id, name: user.name };
  const age = Math.floor(Date.now() / 1000) - claims.iat;
  if (res && !res.headersSent && (age > RENEW_AFTER_SECONDS || claims.name !== user.name)) {
    await issue(res, { ...session, sv: user.sessionVersion, policy: asPolicy(user.sessionPolicy) });
  }
  return session;
}
