// Shared DTO types describing the JSON the API returns and the client consumes.
import type { SplitMode } from "./split.js";

export type PublicUser = {
  id: string;
  name: string;
  avatar?: string | null;
};

export type ReminderFrequency = "daily" | "weekly" | "monthly";

// The signed-in user, including their personal settings. Returned by
// /auth/me, /auth/login, /auth/register and /auth/settings.
export type SelfUser = PublicUser & {
  defaultCurrency: string;
  reminderEnabled: boolean;
  reminderFrequency: ReminderFrequency;
  createdAt?: string;
};

export type Role = "owner" | "moderator" | "member";

export type GroupSummary = {
  id: string;
  name: string;
  emoji?: string | null;
  thumbnail?: string | null;
  currency: string;
  role: Role;
  memberCount: number;
  // Net balance for the CURRENT user in this group. >0 → you are owed; <0 → you owe.
  net: number;
};

export type GroupMember = PublicUser & { role: Role };

export type GroupDetail = {
  id: string;
  name: string;
  emoji?: string | null;
  thumbnail?: string | null;
  currency: string;
  role: Role;
  createdAt: string;
  createdBy?: PublicUser | null;
  myUserId: string;
  members: GroupMember[];
};

// Per-member spend breakdown (advanced metric, elevated roles only).
export type MemberStat = PublicUser & {
  paid: number; // total they paid for the group
  share: number; // total they were responsible for
  net: number; // paid - share
};

// Group metrics. `basic` is visible to every member; `advanced` is only
// returned to owners and moderators.
export type GroupStats = {
  basic: {
    createdAt: string;
    memberCount: number;
    expenseCount: number;
    totalSpent: number;
    firstExpenseAt?: string | null;
    lastActivityAt?: string | null;
    myPaid: number;
    myShare: number;
    settledCount: number;
    pendingSettlements: number;
  };
  advanced?: {
    avgExpense: number;
    largestExpense: number;
    activeDays: number;
    settlementVolume: number;
    topSpender?: { id: string; name: string; amount: number } | null;
    perMember: MemberStat[];
    categories: { name: string; amount: number }[];
  } | null;
};

export type ExpenseShare = {
  userId: string;
  name: string;
  amount: number;
};

export type Expense = {
  id: string;
  groupId: string;
  title: string;
  category: string;
  amount: number;
  paidBy: PublicUser;
  createdBy?: PublicUser;
  date: string;
  notes?: string | null;
  splitMode: SplitMode;
  hasThumbnail: boolean;
  thumbnail?: string | null;
  shares: ExpenseShare[];
  createdAt: string;
};

export type SettlementStatus = "pending" | "approved" | "declined";

export type Settlement = {
  id: string;
  groupId: string;
  from: PublicUser;
  to: PublicUser;
  amount: number;
  note?: string | null;
  status: SettlementStatus;
  hasThumbnail: boolean;
  thumbnail?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  // Convenience flags for the current viewer.
  incoming?: boolean; // the current user is the recipient (can approve)
};

// Net balance per member within a group. net>0 → owed; net<0 → owes.
export type Balance = PublicUser & { net: number };

// A simplified "who pays whom" debt after netting the whole group.
export type Debt = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
};

export type PendingInvite = {
  id: string;
  createdAt: string;
  group: { id: string; name: string; emoji?: string | null; thumbnail?: string | null };
  invitedBy: PublicUser;
};
