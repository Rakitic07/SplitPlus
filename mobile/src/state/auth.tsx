import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  api,
  ApiError,
  loadAuthToken,
  onSessionEnded,
  setAuthToken,
  type ResetAnswers,
} from "../lib/api";
import { storage } from "../lib/storage";
import { THEME_KEY } from "../theme";
import type { SelfUser } from "../shared/types";

type Status = "loading" | "authed" | "guest";

// register / recover / resetVerify return the account + one-time recovery code
// WITHOUT flipping to "authed" — the caller shows the code first, then calls
// finishAuth() so the code screen isn't skipped (mirrors the web flow).
type AuthResult = { user: SelfUser; recoveryCode: string };

type AuthCtx = {
  status: Status;
  user: SelfUser | null;
  setUser: (u: SelfUser) => void;
  login: (nameOrEmail: string, passphrase: string) => Promise<SelfUser>;
  register: (name: string, passphrase: string) => Promise<AuthResult>;
  recover: (name: string, code: string, passphrase: string) => Promise<AuthResult>;
  resetVerify: (name: string, passphrase: string, answers: ResetAnswers) => Promise<AuthResult>;
  finishAuth: (user: SelfUser) => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

// Last known profile, so a slow or unreachable server on launch doesn't look
// like being logged out.
const USER_KEY = "splitplus_user";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ask the server who we are, retrying through cold starts and flaky networks.
// Only a definitive answer ("not authenticated" / session 401) counts as signed out.
async function fetchMe(attempts: number): Promise<{ authenticated: boolean; user?: SelfUser }> {
  for (let i = 0; ; i++) {
    try {
      return await api.me();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { authenticated: false };
      if (i >= attempts - 1) throw err;
      await sleep(1500 * 2 ** i);
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<SelfUser | null>(null);

  const remember = useCallback((u: SelfUser) => {
    setUserState(u);
    storage.setJSON(USER_KEY, u);
    // Picked up by index.ts on the next launch (themes can't swap live).
    if (u.theme) storage.setItem(THEME_KEY, u.theme);
  }, []);

  // The theme is a personal setting: the next launch after signing out uses the default.
  const signedOut = useCallback(() => {
    setAuthToken(null);
    storage.setJSON(USER_KEY, null);
    storage.setItem(THEME_KEY, "glass");
    setUserState(null);
    setStatus("guest");
  }, []);

  useEffect(() => {
    onSessionEnded(signedOut);
    return () => onSessionEnded(null);
  }, [signedOut]);

  useEffect(() => {
    (async () => {
      const token = await loadAuthToken();
      if (!token) {
        setStatus("guest");
        return;
      }
      const cached = await storage.getJSON<SelfUser>(USER_KEY);
      if (cached) {
        setUserState(cached);
        setStatus("authed");
      }
      try {
        const r = await fetchMe(cached ? 4 : 3);
        if (r.authenticated && r.user) {
          remember(r.user);
          setStatus("authed");
        } else signedOut();
      } catch {
        // Server unreachable: keep the token so the next launch can retry.
        if (!cached) setStatus("guest");
      }
    })();
  }, [remember, signedOut]);

  const login = useCallback(
    async (name: string, passphrase: string) => {
      const { user } = await api.login(name, passphrase);
      remember(user);
      setStatus("authed");
      return user;
    },
    [remember]
  );

  // Deferred auth: keep the account handy but stay "guest" until finishAuth so
  // the one-time recovery code screen gets shown before we jump to Home.
  const register = useCallback(async (name: string, passphrase: string) => {
    const { user, recoveryCode } = await api.register(name, passphrase);
    return { user, recoveryCode };
  }, []);

  const recover = useCallback(async (name: string, code: string, passphrase: string) => {
    const { user, recoveryCode } = await api.recover(name, code, passphrase);
    return { user, recoveryCode };
  }, []);

  const resetVerify = useCallback(
    async (name: string, passphrase: string, answers: ResetAnswers) => {
      const { user, recoveryCode } = await api.resetVerify(name, passphrase, answers);
      return { user, recoveryCode };
    },
    []
  );

  const finishAuth = useCallback(
    (u: SelfUser) => {
      remember(u);
      setStatus("authed");
    },
    [remember]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      signedOut();
    }
  }, [signedOut]);

  const logoutAll = useCallback(async () => {
    await api.logoutAll();
    signedOut();
  }, [signedOut]);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user,
      setUser: remember,
      login,
      register,
      recover,
      resetVerify,
      finishAuth,
      logout,
      logoutAll,
    }),
    [status, user, remember, login, register, recover, resetVerify, finishAuth, logout, logoutAll]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
