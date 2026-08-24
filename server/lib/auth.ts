import { parse, serialize } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response } from "express";
import { prisma } from "./prisma.js";

const COOKIE_NAME = "splitplus_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

// Sign the session JWT, set it as an HttpOnly cookie (web) AND return it so the
// native app can persist it and send it via the Authorization header.
export async function createSession(res: Response, payload: Session): Promise<string> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());

  res.setHeader(
    "Set-Cookie",
    serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    })
  );

  return token;
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

// Verify the JWT from the Bearer header (native) or the cookie (web). Does NOT
// touch the DB — cheap, for endpoints that only need the id.
export async function readSession(req: Request): Promise<Session | null> {
  const authz = req.headers.authorization;
  const bearer =
    authz && authz.toLowerCase().startsWith("bearer ")
      ? authz.slice(7).trim()
      : null;

  const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
  const token = bearer || cookies[COOKIE_NAME];
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId === "string" && typeof payload.name === "string") {
      return { userId: payload.userId, name: payload.name };
    }
    return null;
  } catch {
    return null;
  }
}

// Like readSession, but also confirms the user still exists (guards stale
// tokens after a DB reset). Returns the fresh name from the DB.
export async function getActiveUser(req: Request): Promise<Session | null> {
  const session = await readSession(req);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true },
  });
  if (!user) return null;
  return { userId: user.id, name: user.name };
}
