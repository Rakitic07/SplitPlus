import { z } from "zod";

// ── Auth ────────────────────────────────────────────────────────────────
const nameField = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(40, "Name is too long");

const passField = z
  .string()
  .min(6, "Passphrase must be at least 6 characters")
  .max(128, "Passphrase is too long");

export const authSchema = z.object({
  name: nameField,
  passphrase: passField,
});

export const recoverSchema = z.object({
  name: nameField,
  recoveryCode: z.string().trim().min(4, "Recovery code is required").max(64),
  passphrase: passField,
});

// Knowledge-based recovery — used when BOTH the passphrase and the recovery
// code are lost. The answers are verified server-side against the account's
// real groups/expenses; enough correct answers let the user set a new
// passphrase (self-service, no admin needed).
const answerField = z.string().trim().max(120).optional().or(z.literal(""));
export const resetVerifySchema = z.object({
  name: nameField,
  passphrase: passField,
  answers: z.object({
    groupName: answerField,
    expenseTitle: answerField,
    amount: answerField,
    memberName: answerField,
    monthYear: answerField,
  }),
});

// "Forgot your name too?" — look up account names by their first characters.
export const findSchema = z.object({
  query: z.string().trim().min(3, "Type at least 3 characters").max(60),
});

// Admin-approved reset: the user proposes a new passphrase (kept only as a hash
// until approval) and answers a short questionnaire an admin verifies against
// real data.
export const resetRequestSchema = z.object({
  name: nameField,
  passphrase: passField,
  questionnaire: z.object({
    groupName: answerField,
    expenseTitle: answerField,
    amount: answerField,
    memberName: answerField,
    note: answerField,
  }),
});

// Check the status of a pending admin reset with the one-time ticket.
export const resetStatusSchema = z.object({
  name: nameField,
  ticket: z.string().trim().min(4, "Ticket is required").max(64),
});

// Admin resolving a request.
export const adminActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

// Tiny base64 image data URL, capped so a full-resolution photo can't be
// smuggled into the DB. base64 grows ~4/3, so ~200k chars ≈ 150KB of bytes.
const imageField = z
  .string()
  .max(220000, "Image is too large")
  .optional()
  .or(z.literal(""));

// ── Settings ────────────────────────────────────────────────────────────
export const reminderFrequencyEnum = z.enum(["daily", "weekly", "monthly"]);

export const settingsSchema = z
  .object({
    avatar: imageField,
    defaultCurrency: z.string().trim().length(3).optional(),
    reminderEnabled: z.boolean().optional(),
    reminderFrequency: reminderFrequencyEnum.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });

// ── Groups ──────────────────────────────────────────────────────────────
export const groupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(60),
  currency: z.string().trim().length(3).optional().or(z.literal("")),
  emoji: z.string().trim().max(8).optional().or(z.literal("")),
  thumbnail: imageField,
});

// Creating a group can optionally invite a batch of existing users up-front.
export const groupCreateSchema = groupSchema.extend({
  inviteeIds: z.array(z.string().min(1)).max(50).optional(),
});

export const groupPatchSchema = groupSchema.partial();

// ── Invites ─────────────────────────────────────────────────────────────
export const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter a name to invite").max(40),
});

export const inviteActionSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

// ── Roles ───────────────────────────────────────────────────────────────
// Owners can only toggle a member between plain member and moderator.
export const roleActionSchema = z.object({
  role: z.enum(["moderator", "member"]),
});

// ── Expenses ────────────────────────────────────────────────────────────
export const splitModeEnum = z.enum(["equal", "exact", "percent", "shares"]);

const shareInput = z.object({
  userId: z.string().min(1),
  included: z.boolean(),
  value: z.number().nonnegative().max(100_000_000).optional(),
});

export const expenseSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(80),
    category: z.string().trim().min(1, "Category is required").max(40),
    amount: z
      .number({ invalid_type_error: "Amount must be a number" })
      .positive("Amount must be greater than 0")
      .max(100_000_000, "Amount is too large"),
    paidById: z.string().min(1, "Choose who paid"),
    date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
    notes: z.string().trim().max(500).optional().or(z.literal("")),
    splitMode: splitModeEnum,
    thumbnail: imageField,
    shares: z.array(shareInput).min(1, "Add at least one participant"),
  })
  .refine((d) => d.shares.some((s) => s.included), {
    message: "At least one participant must be included",
    path: ["shares"],
  });

// ── Settlements ─────────────────────────────────────────────────────────
export const settlementSchema = z.object({
  toId: z.string().min(1, "Choose who you're paying"),
  amount: z
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than 0")
    .max(100_000_000, "Amount is too large"),
  note: z.string().trim().max(280).optional().or(z.literal("")),
  thumbnail: imageField,
});

export const settlementActionSchema = z.object({
  action: z.enum(["approve", "decline"]),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
export type GroupInput = z.infer<typeof groupSchema>;
export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
