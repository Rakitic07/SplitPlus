import { API_BASE } from "../config";
import { storage } from "./storage";
import type {
  Balance,
  Debt,
  Expense,
  GroupDetail,
  GroupStats,
  GroupSummary,
  PendingInvite,
  PublicUser,
  ReminderFrequency,
  Role,
  SelfUser,
  Settlement,
} from "../shared/types";
import type { SplitMode } from "../shared/split";
import type { AndroidRelease } from "../shared/appVersion";

// Public web address of the app (API base minus the trailing "/api"), used for
// shareable invite links (WhatsApp / system share).
export const APP_URL = API_BASE.replace(/\/api\/?$/, "");

let memToken: string | null = null;

export function setAuthToken(token: string | null) {
  memToken = token;
  storage.setToken(token);
}
export async function loadAuthToken(): Promise<string | null> {
  memToken = await storage.getToken();
  return memToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers["Content-Type"] = "application/json";
  if (memToken) headers.Authorization = `Bearer ${memToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? "Something went wrong", res.status);
  return data as T;
}

const body = (v: unknown) => JSON.stringify(v);

export type ExportExpense = {
  id: string;
  groupId: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  notes: string | null;
  splitMode: string;
  paidBy: { id: string; name: string };
  myShare: number;
  group: { id: string; name: string; emoji: string | null; currency: string };
};

// A cross-group expense hit from the global search.
export type SearchExpense = {
  id: string;
  groupId: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  paidBy: PublicUser;
  group: { id: string; name: string; emoji: string | null; currency: string };
};

export type SettingsInput = {
  avatar?: string;
  defaultCurrency?: string;
  reminderEnabled?: boolean;
  reminderFrequency?: ReminderFrequency;
};

// Knowledge-based verification answers (lost passphrase AND recovery code).
export type ResetAnswers = {
  groupName?: string;
  expenseTitle?: string;
  amount?: string;
  memberName?: string;
  monthYear?: string;
};

// Questionnaire submitted for an admin-approved reset.
export type ResetQuestionnaire = {
  groupName?: string;
  expenseTitle?: string;
  amount?: string;
  memberName?: string;
  note?: string;
};

export type ResetStatus = "pending" | "approved" | "rejected";

export type ShareInputDto = { userId: string; included: boolean; value?: number };
export type ExpenseInputDto = {
  title: string;
  category: string;
  amount: number;
  paidById: string;
  date: string;
  notes?: string;
  splitMode: SplitMode;
  thumbnail?: string;
  shares: ShareInputDto[];
};

export const api = {
  async me() {
    return req<{ authenticated: boolean; user?: SelfUser }>("/auth/me");
  },
  async login(name: string, passphrase: string) {
    const d = await req<{ user: SelfUser; token?: string }>("/auth/login", {
      method: "POST",
      body: body({ name, passphrase }),
    });
    if (d.token) setAuthToken(d.token);
    return d;
  },
  async register(name: string, passphrase: string) {
    const d = await req<{ user: SelfUser; recoveryCode: string; token?: string }>("/auth/register", {
      method: "POST",
      body: body({ name, passphrase }),
    });
    if (d.token) setAuthToken(d.token);
    return d;
  },
  async recover(name: string, recoveryCode: string, passphrase: string) {
    const d = await req<{ user: SelfUser; recoveryCode: string; token?: string }>("/auth/recover", {
      method: "POST",
      body: body({ name, recoveryCode, passphrase }),
    });
    if (d.token) setAuthToken(d.token);
    return d;
  },
  // Recover when the recovery code is ALSO lost — verify a few private details.
  async resetVerify(name: string, passphrase: string, answers: ResetAnswers) {
    const d = await req<{ user: SelfUser; recoveryCode: string; token?: string }>(
      "/auth/reset-verify",
      { method: "POST", body: body({ name, passphrase, answers }) }
    );
    if (d.token) setAuthToken(d.token);
    return d;
  },
  // "Forgot your name too?" — find accounts by the first few characters.
  async findAccount(query: string) {
    return req<{ matches: string[] }>("/auth/find", { method: "POST", body: body({ query }) });
  },
  // Ask an admin to reset the passphrase. Returns a one-time status ticket.
  async requestReset(name: string, passphrase: string, questionnaire: ResetQuestionnaire) {
    return req<{ ticket: string }>("/auth/reset-request", {
      method: "POST",
      body: body({ name, passphrase, questionnaire }),
    });
  },
  // Check whether an admin approved the reset.
  async resetStatus(name: string, ticket: string) {
    return req<{ status: ResetStatus; resolvedAt: string | null }>("/auth/reset-status", {
      method: "POST",
      body: body({ name, ticket }),
    });
  },
  async logout() {
    try {
      await req("/auth/logout", { method: "POST" });
    } finally {
      setAuthToken(null);
    }
  },
  async searchUsers(q: string) {
    return req<{ users: PublicUser[] }>(`/auth/search?q=${encodeURIComponent(q)}`);
  },
  async updateSettings(patch: SettingsInput) {
    return req<{ user: SelfUser }>("/auth/settings", { method: "PATCH", body: body(patch) });
  },
  // Casual, cross-group expense search (results carry their group).
  async searchExpenses(q: string) {
    return req<{ results: SearchExpense[] }>(`/search?q=${encodeURIComponent(q)}`);
  },
  // Latest Android release info (for the in-app update check).
  async version() {
    return req<{ web: string; android: AndroidRelease }>("/version");
  },

  // One round-trip for the whole home screen (groups + invites + incoming
  // settlements). Mirrors the web /api/home — far fewer cold-start round-trips
  // than firing three separate requests.
  async home() {
    return req<{
      groups: GroupSummary[];
      invites: PendingInvite[];
      settlements: (Settlement & {
        group: { id: string; name: string; emoji?: string | null; currency: string };
      })[];
    }>("/home");
  },
  async listGroups() {
    return req<{ groups: GroupSummary[] }>("/groups");
  },
  // One round-trip for the whole group screen (detail + expenses + balances +
  // settlements + stats). Mirrors the web /api/groups/:id/bootstrap.
  async groupBootstrap(id: string) {
    return req<{
      group: GroupDetail;
      expenses: Expense[];
      balances: Balance[];
      debts: Debt[];
      myNet: number;
      settlements: Settlement[];
      stats: GroupStats;
    }>(`/groups/${id}/bootstrap`);
  },
  async createGroup(input: { name: string; emoji?: string; currency?: string; thumbnail?: string }) {
    return req<{ group: GroupSummary }>("/groups", { method: "POST", body: body(input) });
  },
  async getGroup(id: string) {
    return req<{ group: GroupDetail }>(`/groups/${id}`);
  },
  async updateGroup(
    id: string,
    patch: { name?: string; emoji?: string; currency?: string; thumbnail?: string }
  ) {
    return req<{ group: GroupSummary }>(`/groups/${id}`, { method: "PATCH", body: body(patch) });
  },
  async deleteGroup(id: string) {
    return req<{ ok: boolean }>(`/groups/${id}`, { method: "DELETE" });
  },
  async leaveGroup(id: string) {
    return req<{ ok: boolean }>(`/groups/${id}/leave`, { method: "POST" });
  },
  async getBalances(id: string) {
    return req<{ balances: Balance[]; debts: Debt[]; myNet: number }>(`/groups/${id}/balances`);
  },
  async getStats(id: string) {
    return req<{ stats: GroupStats }>(`/groups/${id}/stats`);
  },
  async setMemberRole(groupId: string, userId: string, role: Exclude<Role, "owner">) {
    return req<{ ok: boolean; userId: string; role: Role }>(
      `/groups/${groupId}/members/${userId}/role`,
      { method: "POST", body: body({ role }) }
    );
  },

  async myInvites() {
    return req<{ invites: PendingInvite[] }>("/invites");
  },
  async respondInvite(inviteId: string, action: "accept" | "decline") {
    return req<{ ok: boolean; groupId?: string }>(`/invites/${inviteId}`, {
      method: "POST",
      body: body({ action }),
    });
  },
  async groupInvites(groupId: string) {
    return req<{ invites: { id: string; createdAt: string; invitee: PublicUser }[] }>(
      `/groups/${groupId}/invites`
    );
  },
  async sendInvite(groupId: string, name: string) {
    return req<{ invite: { id: string; createdAt: string; invitee: PublicUser } }>(
      `/groups/${groupId}/invites`,
      { method: "POST", body: body({ name }) }
    );
  },

  async listExpenses(groupId: string) {
    return req<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`);
  },
  async createExpense(groupId: string, input: ExpenseInputDto) {
    return req<{ expense: Expense }>(`/groups/${groupId}/expenses`, {
      method: "POST",
      body: body(input),
    });
  },
  async deleteExpense(groupId: string, expenseId: string) {
    return req<{ ok: boolean }>(`/groups/${groupId}/expenses/${expenseId}`, { method: "DELETE" });
  },

  async listSettlements(groupId: string) {
    return req<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`);
  },
  async createSettlement(groupId: string, input: { toId: string; amount: number; note?: string; thumbnail?: string }) {
    return req<{ settlement: Settlement }>(`/groups/${groupId}/settlements`, {
      method: "POST",
      body: body(input),
    });
  },
  async respondSettlement(groupId: string, id: string, action: "approve" | "decline") {
    return req<{ settlement: Settlement }>(`/groups/${groupId}/settlements/${id}`, {
      method: "POST",
      body: body({ action }),
    });
  },
  async incomingSettlements() {
    return req<{ settlements: (Settlement & { group: { id: string; name: string; emoji?: string | null; currency: string } })[] }>(
      "/settlements/incoming"
    );
  },

  // Every expense across all of the user's groups, for the "overall" export.
  async exportExpenses() {
    return req<{ expenses: ExportExpense[] }>("/export/expenses");
  },
};
