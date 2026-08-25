import type {
  Balance,
  Debt,
  Expense,
  GroupDetail,
  GroupStats,
  GroupSummary,
  PendingInvite,
  PublicUser,
  Role,
  SelfUser,
  Settlement,
} from "@shared/types";
import type {
  ExpenseInput,
  GroupCreateInput,
  GroupInput,
  SettingsInput,
  SettlementInput,
} from "@shared/validation";

// The web app authenticates with the HttpOnly session cookie (same origin), but
// we ALSO keep a copy of the JWT so a token can be attached as a Bearer header
// if cookies are ever blocked (and to mirror the native app's auth path).
const TOKEN_KEY = "splitplus_token";

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// Knowledge-based verification answers used when a user has lost BOTH their
// passphrase and recovery code — checked server-side against their real data.
export type ResetAnswers = {
  groupName?: string;
  expenseTitle?: string;
  amount?: string;
  memberName?: string;
  monthYear?: string;
};

// Questionnaire the user submits when requesting an admin-approved reset.
export type ResetQuestionnaire = {
  groupName?: string;
  expenseTitle?: string;
  amount?: string;
  memberName?: string;
  note?: string;
};

export type ResetStatus = "pending" | "approved" | "rejected";

// A snapshot of platform-wide metrics for the admin dashboard.
export type AdminMetrics = {
  generatedAt: string;
  totals: {
    users: number;
    groups: number;
    expenses: number;
    memberships: number;
    settlements: number;
    settledCount: number;
    grandTotal: number;
    settledTotal: number;
    avgExpense: number;
    avgMembersPerGroup: number;
    avgExpensesPerGroup: number;
    avgGroupsPerUser: number;
    invitesPending: number;
    biggestGroupSize: number;
  };
  growth: {
    users: { d7: number; d30: number };
    groups: { d7: number; d30: number };
    expenses: { d7: number; d30: number };
  };
  series: {
    expenses: { date: string; count: number; total: number }[];
    signups: { date: string; count: number; total: number }[];
  };
  categories: { category: string; count: number; total: number }[];
  splitModes: { mode: string; count: number }[];
  currencies: { currency: string; count: number }[];
  topGroups: { id: string; name: string; emoji: string | null; currency: string; count: number; total: number }[];
  topPayers: { id: string; name: string; count: number; total: number }[];
  engagement: {
    usersWithAvatar: number;
    reminderOn: number;
    groupsWithThumb: number;
    expensesWithReceipt: number;
  };
  recovery: { pending: number; approved: number; rejected: number };
  storage: {
    provider: "postgresql" | "sqlite";
    dbBytes: number | null;
    limitBytes: number | null;
    tables: { name: string; bytes: number }[];
    attachments: {
      avatars: { count: number; bytes: number };
      groupCovers: { count: number; bytes: number };
      receipts: { count: number; bytes: number };
      settlementProofs: { count: number; bytes: number };
      totalCount: number;
      totalBytes: number;
    };
  } | null;
  system: {
    node: string;
    platform: string;
    uptimeSec: number;
    cpuCores: number;
    loadPct: number | null;
    memBasis: "process" | "host";
    memUsedBytes: number;
    memTotalBytes: number;
    rssBytes: number;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
    dbProvider: string;
    region: string | null;
  };
};

// A reset request as seen by an admin in the admin panel.
export type AdminResetRequest = {
  id: string;
  status: ResetStatus;
  createdAt: string;
  resolvedAt: string | null;
  answers: ResetQuestionnaire;
  user: { name: string; memberSince: string };
  truth: {
    groups: string[];
    members: string[];
    expenses: { title: string; amount: number }[];
  };
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

// A flattened expense across every group the user belongs to — used to build
// the "overall" PDF / Excel export on the client.
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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as { error?: string }).error ?? "Something went wrong", res.status);
  }
  return data as T;
}

const body = (v: unknown) => JSON.stringify(v);

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────
  async me() {
    return req<{ authenticated: boolean; user?: SelfUser }>("/auth/me");
  },
  async login(name: string, passphrase: string) {
    const data = await req<{ user: SelfUser; token?: string }>("/auth/login", {
      method: "POST",
      body: body({ name, passphrase }),
    });
    if (data.token) setToken(data.token);
    return data;
  },
  async register(name: string, passphrase: string) {
    const data = await req<{ user: SelfUser; recoveryCode: string; token?: string }>(
      "/auth/register",
      { method: "POST", body: body({ name, passphrase }) }
    );
    if (data.token) setToken(data.token);
    return data;
  },
  async recover(name: string, recoveryCode: string, passphrase: string) {
    const data = await req<{ user: SelfUser; recoveryCode: string; token?: string }>(
      "/auth/recover",
      { method: "POST", body: body({ name, recoveryCode, passphrase }) }
    );
    if (data.token) setToken(data.token);
    return data;
  },
  // Recover when the recovery code is ALSO lost — verify a few private details
  // (a group name, a recent expense, an amount, a co-member) instead.
  async resetVerify(name: string, passphrase: string, answers: ResetAnswers) {
    const data = await req<{ user: SelfUser; recoveryCode: string; token?: string }>(
      "/auth/reset-verify",
      { method: "POST", body: body({ name, passphrase, answers }) }
    );
    if (data.token) setToken(data.token);
    return data;
  },
  // "Forgot your name too?" — find accounts by the first few characters.
  async findAccount(query: string) {
    return req<{ matches: string[] }>("/auth/find", {
      method: "POST",
      body: body({ query }),
    });
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
  // ── Admin ─────────────────────────────────────────────────────────────
  async adminMetrics(secret: string) {
    return req<AdminMetrics>("/admin/metrics", { headers: { "x-admin-secret": secret } });
  },
  async adminListResets(secret: string) {
    return req<{ requests: AdminResetRequest[] }>("/admin/reset-requests", {
      headers: { "x-admin-secret": secret },
    });
  },
  async adminResolveReset(secret: string, id: string, action: "approve" | "reject") {
    return req<{ ok: true; status: ResetStatus }>(`/admin/reset-requests/${id}`, {
      method: "POST",
      headers: { "x-admin-secret": secret },
      body: body({ action }),
    });
  },
  async logout() {
    try {
      await req("/auth/logout", { method: "POST" });
    } finally {
      setToken(null);
    }
  },
  async searchUsers(q: string) {
    return req<{ users: PublicUser[] }>(`/auth/search?q=${encodeURIComponent(q)}`);
  },
  async updateSettings(patch: Partial<SettingsInput>) {
    return req<{ user: SelfUser }>("/auth/settings", {
      method: "PATCH",
      body: body(patch),
    });
  },

  // ── Search ────────────────────────────────────────────────────────────
  // Casual, cross-group expense search. Results carry their group for deep-links.
  async searchExpenses(q: string) {
    return req<{ results: SearchExpense[] }>(`/search?q=${encodeURIComponent(q)}`);
  },

  // Every expense across all of the user's groups, for the "overall" export.
  async exportExpenses() {
    return req<{ expenses: ExportExpense[] }>("/export/expenses");
  },

  // ── Home / dashboard ──────────────────────────────────────────────────
  // One round-trip for the whole dashboard (groups + invites + incoming).
  async home() {
    return req<{
      groups: GroupSummary[];
      invites: PendingInvite[];
      settlements: (Settlement & {
        group: { id: string; name: string; emoji?: string | null; currency: string };
      })[];
    }>("/home");
  },

  // ── Groups ────────────────────────────────────────────────────────────
  async listGroups() {
    return req<{ groups: GroupSummary[] }>("/groups");
  },
  // One round-trip for the whole group page (detail + expenses + balances +
  // settlements + stats).
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
  async createGroup(input: Partial<GroupCreateInput>) {
    return req<{ group: GroupSummary; invited: number }>("/groups", {
      method: "POST",
      body: body(input),
    });
  },
  async getGroup(id: string) {
    return req<{ group: GroupDetail }>(`/groups/${id}`);
  },
  async updateGroup(id: string, patch: Partial<GroupInput>) {
    return req<{ group: GroupSummary }>(`/groups/${id}`, {
      method: "PATCH",
      body: body(patch),
    });
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

  // ── Invites ───────────────────────────────────────────────────────────
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

  // ── Expenses ──────────────────────────────────────────────────────────
  async listExpenses(groupId: string) {
    return req<{ expenses: Expense[] }>(`/groups/${groupId}/expenses`);
  },
  async getExpense(groupId: string, expenseId: string) {
    return req<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}`);
  },
  async createExpense(groupId: string, input: ExpenseInput) {
    return req<{ expense: Expense }>(`/groups/${groupId}/expenses`, {
      method: "POST",
      body: body(input),
    });
  },
  async updateExpense(groupId: string, expenseId: string, input: ExpenseInput) {
    return req<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}`, {
      method: "PATCH",
      body: body(input),
    });
  },
  async deleteExpense(groupId: string, expenseId: string) {
    return req<{ ok: boolean }>(`/groups/${groupId}/expenses/${expenseId}`, {
      method: "DELETE",
    });
  },

  // ── Settlements ───────────────────────────────────────────────────────
  async listSettlements(groupId: string) {
    return req<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`);
  },
  async getSettlement(groupId: string, id: string) {
    return req<{ settlement: Settlement }>(`/groups/${groupId}/settlements/${id}`);
  },
  async createSettlement(groupId: string, input: SettlementInput) {
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
};
