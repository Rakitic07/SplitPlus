import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  authSchema,
  changeNameSchema,
  changePassphraseSchema,
  emailCodeSchema,
  emailRemoveSchema,
  emailResetConfirmSchema,
  emailResetRequestSchema,
  emailStartSchema,
  findSchema,
  loginSchema,
  ntfySchema,
  recoverSchema,
  resetRequestSchema,
  resetStatusSchema,
  resetVerifySchema,
  settingsSchema,
} from "../../shared/validation.js";
import {
  asPolicy,
  createSession,
  clearSession,
  getActiveUser,
  SESSION_HEADER,
} from "../lib/auth.js";
import { avatarData, imageUrl } from "../lib/images.js";
import { ah, requireAuth, zodMessage, type AuthedRequest } from "../lib/http.js";
import {
  generateRecoveryCode,
  generateTicket,
  hashCode,
  hashTicket,
  normalizeCode,
} from "../lib/recovery.js";
import { consumeCode, cooldownLeft, issueCode, maskEmail } from "../lib/emailCodes.js";
import { codeEmail, EmailNotConfiguredError, sendEmail } from "../lib/mailer.js";
import { requestOrigin } from "../lib/images.js";
import {
  checkNtfyServer,
  DEFAULT_NTFY_SERVER,
  normalizeServer,
  NtfyError,
  publish,
} from "../lib/ntfy.js";

export const authRouter = Router();

// A dummy bcrypt hash so a login for a non-existent user still runs a compare —
// keeps response timing constant and avoids leaking whether an account exists.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7dQ6b3q6zJ8b3q6zJ8b3q6zJ8b3q6zC";

const publicUser = (u: { id: string; name: string; avatarVer?: string | null }) => ({
  id: u.id,
  name: u.name,
  avatar: imageUrl("u", u.id, u.avatarVer),
});

// The shape of "me" — public fields plus the personal settings the client
// needs (default currency, reminder prefs).
type SelfRow = {
  id: string;
  name: string;
  avatarVer?: string | null;
  email?: string | null;
  defaultCurrency?: string;
  reminderEnabled?: boolean;
  reminderFrequency?: string;
  sessionPolicy?: string;
  theme?: string;
  ntfyTopic?: string | null;
  ntfyServer?: string | null;
  createdAt?: Date;
};
const selfUser = (u: SelfRow) => ({
  id: u.id,
  name: u.name,
  avatar: imageUrl("u", u.id, u.avatarVer),
  email: u.email ?? null,
  defaultCurrency: u.defaultCurrency ?? "INR",
  reminderEnabled: u.reminderEnabled ?? false,
  reminderFrequency: (u.reminderFrequency ?? "weekly") as "daily" | "weekly" | "monthly",
  sessionPolicy: asPolicy(u.sessionPolicy),
  theme: (u.theme === "neumorph" ? "neumorph" : "glass") as "glass" | "neumorph",
  ntfy: u.ntfyTopic ? { topic: u.ntfyTopic, server: normalizeServer(u.ntfyServer) } : null,
  createdAt: u.createdAt?.toISOString(),
});
const SELF_SELECT = {
  id: true,
  name: true,
  avatarVer: true,
  email: true,
  defaultCurrency: true,
  reminderEnabled: true,
  reminderFrequency: true,
  sessionPolicy: true,
  theme: true,
  ntfyTopic: true,
  ntfyServer: true,
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

// Resolve a login identifier: the username first, then — only if it looks like
// one — a verified recovery email. Accounts without an email stay name-only.
async function findByIdentifier(identifier: string) {
  const key = identifier.trim().toLowerCase();
  const byName = await prisma.user.findUnique({ where: { nameKey: key } });
  if (byName || !key.includes("@")) return byName;
  return prisma.user.findUnique({ where: { email: key } });
}

// POST /api/auth/login — unlock an existing account (name or verified email).
authRouter.post(
  "/login",
  ah(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const { name, passphrase } = parsed.data;
    const user = await findByIdentifier(name);

    const ok = await bcrypt.compare(passphrase, user?.passHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: "Incorrect name/email or passphrase." });
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
      // A new passphrase signs out every other device.
      data: { passHash, recoveryHash, sessionVersion: { increment: 1 } },
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
      data: { passHash, recoveryHash, sessionVersion: { increment: 1 } },
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
    const session = await getActiveUser(req, res);
    if (!session) return res.json({ authenticated: false });
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: SELF_SELECT,
    });
    if (!user) return res.json({ authenticated: false });
    return res.json({ authenticated: true, user: selfUser(user) });
  })
);

// ── Recovery email ──────────────────────────────────────────────────────

function mailError(res: import("express").Response, err: unknown) {
  if (err instanceof EmailNotConfiguredError) {
    return res.status(503).json({ error: err.message });
  }
  return res.status(502).json({ error: "Couldn't send the email. Try again in a minute." });
}

// POST /api/auth/email/start — send a verification code to a new recovery
// email. Requires the current passphrase so a borrowed, unlocked device can't
// silently attach an attacker's address.
authRouter.post(
  "/email/start",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = emailStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
    const { email, passphrase } = parsed.data;

    const me = await prisma.user.findUnique({ where: { id: r.session.userId } });
    if (!me || !(await bcrypt.compare(passphrase, me.passHash))) {
      return res.status(401).json({ error: "Incorrect passphrase." });
    }
    if (me.email === email) {
      return res.status(400).json({ error: "That's already your recovery email." });
    }
    const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) {
      return res.status(409).json({ error: "That email is already linked to another account." });
    }
    const wait = await cooldownLeft(me.id, "verify");
    if (wait > 0) return res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });

    const code = await issueCode(me.id, "verify", email);
    const { text, html } = codeEmail({
      code,
      heading: "Confirm your recovery email",
      intro: `Enter this code in Split+ to link this email to your account “${me.name}”. You'll be able to log in with it and reset a forgotten passphrase.`,
      origin: requestOrigin(),
    });
    try {
      await sendEmail(email, "Confirm your Split+ recovery email", text, html);
    } catch (err) {
      return mailError(res, err);
    }
    return res.json({ ok: true, sentTo: maskEmail(email) });
  })
);

// POST /api/auth/email/verify — confirm the code; the email is saved only now.
authRouter.post(
  "/email/verify",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = emailCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const result = await consumeCode(r.session.userId, "verify", parsed.data.code);
    if (!result.ok) return res.status(400).json({ error: result.error });

    try {
      const user = await prisma.user.update({
        where: { id: r.session.userId },
        data: { email: result.email },
        select: SELF_SELECT,
      });
      return res.json({ user: selfUser(user) });
    } catch {
      return res.status(409).json({ error: "That email is already linked to another account." });
    }
  })
);

// POST /api/auth/email/remove — unlink the recovery email (passphrase required).
authRouter.post(
  "/email/remove",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = emailRemoveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const me = await prisma.user.findUnique({ where: { id: r.session.userId } });
    if (!me || !(await bcrypt.compare(parsed.data.passphrase, me.passHash))) {
      return res.status(401).json({ error: "Incorrect passphrase." });
    }
    const [user] = await prisma.$transaction([
      prisma.user.update({ where: { id: me.id }, data: { email: null }, select: SELF_SELECT }),
      prisma.emailCode.deleteMany({ where: { userId: me.id } }),
    ]);
    return res.json({ user: selfUser(user) });
  })
);

const EMAIL_RESET_SENT =
  "If that account has a recovery email, we've sent a 6-digit code to it. It expires in 15 minutes.";
const EMAIL_RESET_FAIL = "Incorrect or expired code. Request a new one.";

// POST /api/auth/email-reset/request — forgot passphrase: email a reset code.
// Always answers the same way so it never reveals which accounts exist.
authRouter.post(
  "/email-reset/request",
  ah(async (req, res) => {
    const parsed = emailResetRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "Email isn't set up on this server yet." });
    }

    const user = await findByIdentifier(parsed.data.identifier);
    if (user?.email && (await cooldownLeft(user.id, "reset")) === 0) {
      const code = await issueCode(user.id, "reset", user.email);
      const { text, html } = codeEmail({
        code,
        heading: "Reset your passphrase",
        intro: `Someone asked to reset the passphrase for the Split+ account “${user.name}”. Enter this code in the app to set a new one.`,
        origin: requestOrigin(),
      });
      try {
        await sendEmail(user.email, "Reset your Split+ passphrase", text, html);
      } catch (err) {
        console.error("[email-reset] send failed", err);
      }
    }
    return res.json({ ok: true, message: EMAIL_RESET_SENT });
  })
);

// POST /api/auth/email-reset/confirm — set a new passphrase with the code.
// Doesn't sign in: the user logs in with the new passphrase afterwards.
authRouter.post(
  "/email-reset/confirm",
  ah(async (req, res) => {
    const parsed = emailResetConfirmSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
    const { identifier, code, passphrase } = parsed.data;

    const user = await findByIdentifier(identifier);
    if (!user?.email) return res.status(400).json({ error: EMAIL_RESET_FAIL });

    const result = await consumeCode(user.id, "reset", code);
    if (!result.ok || result.email !== user.email) {
      return res.status(400).json({ error: EMAIL_RESET_FAIL });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passHash: await bcrypt.hash(passphrase, 12), sessionVersion: { increment: 1 } },
    });
    return res.json({ ok: true, name: user.name });
  })
);

// POST /api/auth/passphrase — change the passphrase while signed in. Signs out
// every other device; this one gets a fresh token so it stays signed in.
authRouter.post(
  "/passphrase",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = changePassphraseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const me = await prisma.user.findUnique({ where: { id: r.session.userId } });
    if (!me || !(await bcrypt.compare(parsed.data.current, me.passHash))) {
      return res.status(401).json({ error: "Incorrect current passphrase." });
    }
    await prisma.user.update({
      where: { id: me.id },
      data: { passHash: await bcrypt.hash(parsed.data.next, 12), sessionVersion: { increment: 1 } },
    });
    const token = await createSession(res, { userId: me.id, name: me.name });
    return res.json({ ok: true, token });
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

// POST /api/auth/logout-all — revoke every session (this device included) by
// bumping the version every token carries.
authRouter.post(
  "/logout-all",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    await prisma.user.update({
      where: { id: r.session.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    res.removeHeader(SESSION_HEADER);
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
      select: { id: true, name: true, avatarVer: true },
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

    const { avatar, defaultCurrency, reminderEnabled, reminderFrequency, sessionPolicy, theme } =
      parsed.data;
    const user = await prisma.user.update({
      where: { id: r.session.userId },
      data: {
        // `avatar` may be an empty string to clear it.
        ...avatarData(avatar),
        ...(defaultCurrency ? { defaultCurrency: defaultCurrency.toUpperCase() } : {}),
        ...(reminderEnabled !== undefined ? { reminderEnabled } : {}),
        ...(reminderFrequency ? { reminderFrequency } : {}),
        ...(sessionPolicy ? { sessionPolicy } : {}),
        ...(theme ? { theme } : {}),
      },
      select: SELF_SELECT,
    });
    // Re-issue so this device's token picks up the new lifetime right away.
    const token = sessionPolicy
      ? await createSession(res, { userId: user.id, name: user.name })
      : undefined;
    return res.json({ user: selfUser(user), ...(token ? { token } : {}) });
  })
);

// PUT /api/auth/ntfy — save the ntfy topic (and optional self-hosted server)
// that settlement notifications are pushed to.
authRouter.put(
  "/ntfy",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = ntfySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
    const server = normalizeServer(parsed.data.server);
    if (server !== DEFAULT_NTFY_SERVER) {
      const problem = await checkNtfyServer(server);
      if (problem) return res.status(400).json({ error: problem });
    }
    const user = await prisma.user.update({
      where: { id: r.session.userId },
      data: {
        ntfyTopic: parsed.data.topic,
        ntfyServer: server === DEFAULT_NTFY_SERVER ? null : server,
      },
      select: SELF_SELECT,
    });
    return res.json({ user: selfUser(user) });
  })
);

// GET /api/auth/ntfy/suggest — a fresh random topic (for clients without a
// secure random generator).
authRouter.get(
  "/ntfy/suggest",
  requireAuth,
  ah(async (_req, res) => {
    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    const bytes = randomBytes(16);
    const topic = `splitplus-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
    return res.json({ topic });
  })
);

// DELETE /api/auth/ntfy — stop push notifications.
authRouter.delete(
  "/ntfy",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const user = await prisma.user.update({
      where: { id: r.session.userId },
      data: { ntfyTopic: null, ntfyServer: null },
      select: SELF_SELECT,
    });
    return res.json({ user: selfUser(user) });
  })
);

// POST /api/auth/ntfy/test — send a sample notification (with banner) to the
// saved topic, or to the one in the body so it can be tried before saving.
const lastTest = new Map<string, number>();
authRouter.post(
  "/ntfy/test",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const me = r.session.userId;
    const since = Date.now() - (lastTest.get(me) ?? 0);
    if (since < 10_000) {
      return res.status(429).json({ error: "Give it a few seconds before testing again." });
    }

    let target: { topic: string; server: string | null } | null = null;
    if (req.body && typeof req.body.topic === "string" && req.body.topic.trim()) {
      const parsed = ntfySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
      target = { topic: parsed.data.topic, server: parsed.data.server || null };
    } else {
      const u = await prisma.user.findUnique({ where: { id: me }, select: { ntfyTopic: true, ntfyServer: true } });
      if (u?.ntfyTopic) target = { topic: u.ntfyTopic, server: u.ntfyServer };
    }
    if (!target) return res.status(400).json({ error: "Add your ntfy topic first." });

    lastTest.set(me, Date.now());
    const origin = requestOrigin();
    try {
      await publish(target, {
        title: "It works! Split+ notifications are on",
        message: "You'll get a ping like this when someone pays you, or confirms or declines your payment.",
        tags: ["tada"],
        priority: 4,
        click: origin || undefined,
        banner: { k: "t", u: me },
      });
    } catch (err) {
      return res.status(502).json({ error: err instanceof NtfyError ? err.message : "Couldn't send the test." });
    }
    return res.json({ ok: true });
  })
);

// A user may rename themselves at most twice within any rolling 30-day window.
const NAME_CHANGE_LIMIT = 2;
const NAME_CHANGE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// How many name changes the user has left in the current window, and when the
// next slot frees up (30 days after the oldest change still inside the window).
async function nameChangeStatus(userId: string) {
  const windowStart = new Date(Date.now() - NAME_CHANGE_WINDOW_DAYS * DAY_MS);
  const recent = await prisma.nameChange.findMany({
    where: { userId, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const used = recent.length;
  const remaining = Math.max(0, NAME_CHANGE_LIMIT - used);
  const nextChangeAt =
    remaining > 0 || recent.length === 0
      ? null
      : new Date(recent[0].createdAt.getTime() + NAME_CHANGE_WINDOW_DAYS * DAY_MS);
  return {
    limit: NAME_CHANGE_LIMIT,
    windowDays: NAME_CHANGE_WINDOW_DAYS,
    used,
    remaining,
    nextChangeAt: nextChangeAt ? nextChangeAt.toISOString() : null,
  };
}

// GET /api/auth/name-status — remaining name changes for the current window.
authRouter.get(
  "/name-status",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    return res.json(await nameChangeStatus(r.session.userId));
  })
);

// PATCH /api/auth/name — change the display name (max 2 / 30 days), guarding
// case-insensitive uniqueness against every other account.
authRouter.patch(
  "/name",
  requireAuth,
  ah(async (req, res) => {
    const r = req as AuthedRequest;
    const parsed = changeNameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });

    const newName = parsed.data.name; // trimmed by zod
    const newKey = newName.toLowerCase();

    const me = await prisma.user.findUnique({
      where: { id: r.session.userId },
      select: { name: true, nameKey: true },
    });
    if (!me) return res.status(404).json({ error: "Account not found." });

    // Case/spacing-only tweak of your OWN name: allowed freely — no clash is
    // possible and it doesn't consume the rename quota.
    if (newKey === me.nameKey) {
      if (newName === me.name) {
        return res.status(400).json({ error: "That's already your name." });
      }
      const updated = await prisma.user.update({
        where: { id: r.session.userId },
        data: { name: newName },
        select: SELF_SELECT,
      });
      const token = await createSession(res, { userId: updated.id, name: updated.name });
      return res.json({ user: selfUser(updated), status: await nameChangeStatus(updated.id), token });
    }

    // A real rename → enforce the rolling limit before touching anything.
    const status = await nameChangeStatus(r.session.userId);
    if (status.remaining <= 0) {
      const when = status.nextChangeAt
        ? new Date(status.nextChangeAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "later";
      return res.status(429).json({
        error: `You can change your name at most ${NAME_CHANGE_LIMIT} times every ${NAME_CHANGE_WINDOW_DAYS} days. You can change it again on ${when}.`,
        status,
      });
    }

    // Case-insensitive uniqueness against everyone else.
    const clash = await prisma.user.findUnique({
      where: { nameKey: newKey },
      select: { id: true },
    });
    if (clash) {
      return res.status(409).json({ error: "That name is already taken. Try another one." });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id: r.session.userId },
          data: { name: newName, nameKey: newKey },
          select: SELF_SELECT,
        });
        await tx.nameChange.create({
          data: { userId: r.session.userId, oldName: me.name, newName },
        });
        return u;
      });
      const token = await createSession(res, { userId: updated.id, name: updated.name });
      return res.json({ user: selfUser(updated), status: await nameChangeStatus(updated.id), token });
    } catch (err) {
      // Unique-constraint race: someone grabbed the name between check and write.
      if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
        return res.status(409).json({ error: "That name was just taken. Try another one." });
      }
      throw err;
    }
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
      data: avatarData(avatar ?? ""),
      select: SELF_SELECT,
    });
    return res.json({ user: selfUser(user) });
  })
);
