import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import {
  authSchema,
  findSchema,
  recoverSchema,
  resetRequestSchema,
  resetStatusSchema,
  resetVerifySchema,
  settingsSchema,
} from "../../shared/validation.js";
import { createSession, clearSession, getActiveUser } from "../lib/auth.js";
import { ah, requireAuth, zodMessage, type AuthedRequest } from "../lib/http.js";
import {
  generateRecoveryCode,
  generateTicket,
  hashCode,
  hashTicket,
  normalizeCode,
} from "../lib/recovery.js";

export const authRouter = Router();

// A dummy bcrypt hash so a login for a non-existent user still runs a compare —
// keeps response timing constant and avoids leaking whether an account exists.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7dQ6b3q6zJ8b3q6zJ8b3q6zJ8b3q6zC";

const publicUser = (u: { id: string; name: string; avatar?: string | null }) => ({
  id: u.id,
  name: u.name,
  avatar: u.avatar ?? null,
});

// The shape of "me" — public fields plus the personal settings the client
// needs (default currency, reminder prefs).
type SelfRow = {
  id: string;
  name: string;
  avatar?: string | null;
  defaultCurrency?: string;
  reminderEnabled?: boolean;
  reminderFrequency?: string;
  createdAt?: Date;
};
const selfUser = (u: SelfRow) => ({
  id: u.id,
  name: u.name,
  avatar: u.avatar ?? null,
  defaultCurrency: u.defaultCurrency ?? "INR",
  reminderEnabled: u.reminderEnabled ?? false,
  reminderFrequency: (u.reminderFrequency ?? "weekly") as "daily" | "weekly" | "monthly",
  createdAt: u.createdAt?.toISOString(),
});
const SELF_SELECT = {
  id: true,
  name: true,
  avatar: true,
  defaultCurrency: true,
  reminderEnabled: true,
  reminderFrequency: true,
  createdAt: true,
} as const;

// POST /api/auth/register — create a new account (first "unlock" of a name).
authRouter.post(
  "/register",
  ah(async (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, passphrase } = parsed.data;
    const nameKey = name.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { nameKey } });
    if (existing) {
      return res.status(409).json({
        error: "That name is already taken. Log in with its passphrase instead.",
      });
    }

    const passHash = await bcrypt.hash(passphrase, 12);
    const recoveryCode = generateRecoveryCode();
    const recoveryHash = await bcrypt.hash(normalizeCode(recoveryCode), 12);

    const user = await prisma.user.create({
      data: { name, nameKey, passHash, recoveryHash },
    });

    const token = await createSession(res, { userId: user.id, name: user.name });
    return res.status(201).json({ user: selfUser(user), recoveryCode, token });
  })
);

// POST /api/auth/login — unlock an existing account.
authRouter.post(
  "/login",
  ah(async (req, res) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, passphrase } = parsed.data;
    const user = await prisma.user.findUnique({ where: { nameKey: name.toLowerCase() } });

    const ok = await bcrypt.compare(passphrase, user?.passHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: "Incorrect name or passphrase." });
    }

    const token = await createSession(res, { userId: user.id, name: user.name });
    return res.json({ user: selfUser(user), token });
  })
);

// POST /api/auth/recover — reset the passphrase with the one-time recovery code.
authRouter.post(
  "/recover",
  ah(async (req, res) => {
    const parsed = recoverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, recoveryCode, passphrase } = parsed.data;
    const user = await prisma.user.findUnique({ where: { nameKey: name.toLowerCase() } });

    const ok =
      user?.recoveryHash &&
      (await bcrypt.compare(normalizeCode(recoveryCode), user.recoveryHash));
    if (!user || !ok) {
      return res.status(401).json({ error: "Incorrect name or recovery code." });
    }

    // Rotate: set the new passphrase AND issue a fresh recovery code.
    const passHash = await bcrypt.hash(passphrase, 12);
    const newRecovery = generateRecoveryCode();
    const recoveryHash = await bcrypt.hash(normalizeCode(newRecovery), 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passHash, recoveryHash },
      select: SELF_SELECT,
    });

    const token = await createSession(res, { userId: user.id, name: user.name });
    return res.json({ user: selfUser(updated), recoveryCode: newRecovery, token });
  })
);

// Generic message reused for every knowledge-recovery failure (bad name OR too
// few correct answers) so we never leak whether an account exists.
const VERIFY_FAIL =
  "We couldn't verify enough details. Try your recovery code, or add more correct details.";

const norm = (s?: string) => (s ?? "").trim().toLowerCase();

// A soft, human-friendly match: exact, or either string contains the other.
function fuzzyIn(ans: string, set: Set<string>): boolean {
  if (ans.length < 2) return false;
  for (const item of set) {
    if (!item) continue;
    if (item === ans || item.includes(ans) || ans.includes(item)) return true;
  }
  return false;
}

function parseAmount(s?: string): number | null {
  const n = Number((s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// POST /api/auth/reset-verify — recover when BOTH the passphrase and recovery
// code are lost. Verify a few private details against the account's real data;
// enough correct answers let the user set a new passphrase. No admin needed.
authRouter.post(
  "/reset-verify",
  ah(async (req, res) => {
    const parsed = resetVerifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, passphrase, answers } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { nameKey: name.toLowerCase() },
      select: { id: true },
    });
    if (!user) return res.status(401).json({ error: VERIFY_FAIL });

    // Gather the account's real data to check answers against.
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      select: {
        group: {
          select: {
            name: true,
            members: { select: { user: { select: { id: true, name: true } } } },
            expenses: { select: { title: true, amount: true } },
          },
        },
      },
    });

    const groupNames = new Set<string>();
    const memberNames = new Set<string>();
    const expenseTitles = new Set<string>();
    const amounts: number[] = [];
    for (const m of memberships) {
      groupNames.add(norm(m.group.name));
      for (const gm of m.group.members) {
        if (gm.user.id !== user.id) memberNames.add(norm(gm.user.name));
      }
      for (const e of m.group.expenses) {
        expenseTitles.add(norm(e.title));
        amounts.push(e.amount);
      }
    }

    // No data to verify against — can't self-serve; must use the recovery code.
    if (groupNames.size === 0 && expenseTitles.size === 0) {
      return res.status(401).json({ error: VERIFY_FAIL });
    }

    let score = 0;
    if (fuzzyIn(norm(answers.groupName), groupNames)) score++;
    if (fuzzyIn(norm(answers.expenseTitle), expenseTitles)) score++;
    if (fuzzyIn(norm(answers.memberName), memberNames)) score++;
    const amt = parseAmount(answers.amount);
    if (amt !== null && amounts.some((a) => Math.abs(a - amt) < 0.5)) score++;

    // Require at least two independent details to match.
    if (score < 2) return res.status(401).json({ error: VERIFY_FAIL });

    const passHash = await bcrypt.hash(passphrase, 12);
    const newRecovery = generateRecoveryCode();
    const recoveryHash = await bcrypt.hash(normalizeCode(newRecovery), 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passHash, recoveryHash },
      select: SELF_SELECT,
    });

    const token = await createSession(res, { userId: updated.id, name: updated.name });
    return res.json({ user: selfUser(updated), recoveryCode: newRecovery, token });
  })
);

// POST /api/auth/find — "forgot your name too?" Look up account names by the
// first characters. Deliberately reveals names (a product feature, mirroring
// Spendly-Plus) but requires ≥3 characters and caps the result count.
authRouter.post(
  "/find",
  ah(async (req, res) => {
    const parsed = findSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const q = parsed.data.query.toLowerCase();
    const users = await prisma.user.findMany({
      where: { nameKey: { startsWith: q } },
      select: { name: true },
      take: 8,
      orderBy: { name: "asc" },
    });
    return res.json({ matches: users.map((u) => u.name) });
  })
);

// POST /api/auth/reset-request — ask an admin to reset the passphrase. Nothing
// changes now: we store the *proposed* new passphrase (hashed) plus a short
// questionnaire, and hand back a one-time ticket to check status. An admin
// verifies the answers and approves in the admin panel.
authRouter.post(
  "/reset-request",
  ah(async (req, res) => {
    const parsed = resetRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, passphrase, questionnaire } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { nameKey: name.toLowerCase() },
      select: { id: true },
    });
    if (!user) {
      return res.status(404).json({ error: "No Split+ account uses that name." });
    }

    const proposedHash = await bcrypt.hash(passphrase, 12);
    const ticket = generateTicket();
    const ticketHash = hashTicket(ticket);

    // One live request per user — clear any older pending ones.
    await prisma.resetRequest.deleteMany({ where: { userId: user.id, status: "pending" } });
    await prisma.resetRequest.create({
      data: {
        userId: user.id,
        ticketHash,
        proposedHash,
        questionnaire: JSON.stringify(questionnaire),
      },
    });

    return res.status(201).json({ ticket });
  })
);

// POST /api/auth/reset-status — check whether an admin approved the reset.
authRouter.post(
  "/reset-status",
  ah(async (req, res) => {
    const parsed = resetStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, ticket } = parsed.data;
    const rr = await prisma.resetRequest.findUnique({
      where: { ticketHash: hashTicket(ticket) },
      select: { status: true, resolvedAt: true, user: { select: { nameKey: true } } },
    });
    if (!rr || rr.user.nameKey !== name.toLowerCase()) {
      return res.status(404).json({ error: "No request found for that name and ticket." });
    }
    return res.json({
      status: rr.status as "pending" | "approved" | "rejected",
      resolvedAt: rr.resolvedAt?.toISOString() ?? null,
    });
  })
);

// GET /api/auth/me — who am I?
authRouter.get(
  "/me",
  ah(async (req, res) => {
    const session = await getActiveUser(req);
    if (!session) return res.json({ authenticated: false });
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: SELF_SELECT,
    });
    if (!user) return res.json({ authenticated: false });
    return res.json({ authenticated: true, user: selfUser(user) });
  })
);

// POST /api/auth/logout
authRouter.post(
  "/logout",
  ah(async (_req, res) => {
    clearSession(res);
    return res.json({ ok: true });
  })
);

// GET /api/auth/search?q= — find users to invite (substring match, min 3 chars).
authRouter.get(
  "/search",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (q.length < 3) return res.json({ users: [] });

    const users = await prisma.user.findMany({
      where: {
        nameKey: { contains: q },
        NOT: { id: r.session.userId },
      },
      select: { id: true, name: true, avatar: true },
      take: 8,
      orderBy: { name: "asc" },
    });
    return res.json({ users: users.map(publicUser) });
  })
);

// PATCH /api/auth/settings — update avatar, default currency and reminder prefs.
authRouter.patch(
  "/settings",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { avatar, defaultCurrency, reminderEnabled, reminderFrequency } = parsed.data;
    const user = await prisma.user.update({
      where: { id: r.session.userId },
      data: {
        // `avatar` may be an empty string to clear it — treat "" as null.
        ...(avatar !== undefined ? { avatar: avatar || null } : {}),
        ...(defaultCurrency ? { defaultCurrency: defaultCurrency.toUpperCase() } : {}),
        ...(reminderEnabled !== undefined ? { reminderEnabled } : {}),
        ...(reminderFrequency ? { reminderFrequency } : {}),
      },
      select: SELF_SELECT,
    });
    return res.json({ user: selfUser(user) });
  })
);

// PATCH /api/auth/profile — legacy avatar-only endpoint (kept for compatibility).
authRouter.patch(
  "/profile",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const avatar = typeof req.body?.avatar === "string" ? req.body.avatar : null;
    if (avatar && avatar.length > 220000) {
      return res.status(400).json({ error: "Avatar image is too large" });
    }
    const user = await prisma.user.update({
      where: { id: r.session.userId },
      data: { avatar: avatar || null },
      select: SELF_SELECT,
    });
    return res.json({ user: selfUser(user) });
  })
);
