import { API_BASE } from "../config";
import { storage } from "./storage";
import type {
  Balance,
  Debt,
  Expense,
  GroupDetail,
  GroupSummary,
  PendingInvite,
  PublicUser,
  Settlement,
} from "../shared/types";
import type { SplitMode } from "../shared/split";

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
    return req<{ authenticated: boolean; user?: PublicUser }>("/auth/me");
  },
  async login(name: string, passphrase: string) {
    const d = await req<{ user: PublicUser; token?: string }>("/auth/login", {
      method: "POST",
      body: body({ name, passphrase }),
    });
    if (d.token) setAuthToken(d.token);
    return d;
  },
  async register(name: string, passphrase: string) {
    const d = await req<{ user: PublicUser; recoveryCode: string; token?: string }>("/auth/register", {
      method: "POST",
      body: body({ name, passphrase }),
    });
    if (d.token) setAuthToken(d.token);
    return d;
  },
  async recover(name: string, recoveryCode: string, passphrase: string) {
    const d = await req<{ user: PublicUser; recoveryCode: string; token?: string }>("/auth/recover", {
      method: "POST",
      body: body({ name, recoveryCode, passphrase }),
    });
    if (d.token) setAuthToken(d.token);
    return d;
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

  async listGroups() {
    return req<{ groups: GroupSummary[] }>("/groups");
  },
  async createGroup(input: { name: string; emoji?: string; currency?: string; thumbnail?: string }) {
    return req<{ group: GroupSummary }>("/groups", { method: "POST", body: body(input) });
  },
  async getGroup(id: string) {
    return req<{ group: GroupDetail }>(`/groups/${id}`);
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

  async myInvites() {
    return req<{ invites: PendingInvite[] }>("/invites");
  },
  async respondInvite(inviteId: string, action: "accept" | "decline") {
    return req<{ ok: boolean; groupId?: string }>(`/invites/${inviteId}`, {
      method: "POST",
      body: body({ action }),
    });
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
};
