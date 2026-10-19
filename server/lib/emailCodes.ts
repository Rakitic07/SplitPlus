import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";

export type CodePurpose = "verify" | "reset";

const TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;

// Purpose-scoped key derived from AUTH_SECRET, so code hashes never share a key
// with session signing.
let cachedKey: Buffer | null = null;
function codeKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is not set.");
  cachedKey = Buffer.from(hkdfSync("sha256", secret, "split-plus", "email-code-v1", 32));
  return cachedKey;
}

const hashFor = (userId: string, purpose: CodePurpose, email: string, code: string) =>
  createHmac("sha256", codeKey()).update(`${userId}|${purpose}|${email}|${code}`).digest("hex");

/** Seconds the user must wait before another code can be sent (0 = now). */
export async function cooldownLeft(userId: string, purpose: CodePurpose): Promise<number> {
  const last = await prisma.emailCode.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!last) return 0;
  const left = RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime());
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Issue a fresh 6-digit code (replacing any earlier one for this purpose). */
export async function issueCode(userId: string, purpose: CodePurpose, email: string): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.$transaction([
    prisma.emailCode.deleteMany({ where: { userId, purpose } }),
    prisma.emailCode.create({
      data: {
        userId,
        purpose,
        email,
        codeHash: hashFor(userId, purpose, email, code),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    }),
  ]);
  return code;
}

/**
 * Check a code. On success the code is consumed and its target email returned;
 * wrong guesses count toward a small attempt limit, after which the code dies.
 */
export async function consumeCode(
  userId: string,
  purpose: CodePurpose,
  code: string
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const row = await prisma.emailCode.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: "desc" },
  });
  const expired = !row || row.expiresAt.getTime() < Date.now() || row.attempts >= MAX_ATTEMPTS;
  if (expired) {
    if (row) await prisma.emailCode.delete({ where: { id: row.id } }).catch(() => {});
    return { ok: false, error: "That code has expired. Request a new one." };
  }

  const expected = Buffer.from(row.codeHash, "hex");
  const given = Buffer.from(hashFor(userId, purpose, row.email, code.trim()), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await prisma.emailCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "Incorrect code." };
  }

  await prisma.emailCode.deleteMany({ where: { userId, purpose } });
  return { ok: true, email: row.email };
}

/** Partially hide an email for display, e.g. "ra•••@gmail.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(5, local.length - 2)))}@${domain}`;
}
