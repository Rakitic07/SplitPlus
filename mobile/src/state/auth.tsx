import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, loadAuthToken, type ResetAnswers } from "../lib/api";
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
  login: (name: string, passphrase: string) => Promise<void>;
  register: (name: string, passphrase: string) => Promise<AuthResult>;
  recover: (name: string, code: string, passphrase: string) => Promise<AuthResult>;
  resetVerify: (name: string, passphrase: string, answers: ResetAnswers) => Promise<AuthResult>;
  finishAuth: (user: SelfUser) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SelfUser | null>(null);

  useEffect(() => {
    (async () => {
      await loadAuthToken();
      try {
        const r = await api.me();
        if (r.authenticated && r.user) {
          setUser(r.user);
          setStatus("authed");
        } else setStatus("guest");
      } catch {
        setStatus("guest");
      }
    })();
  }, []);

  const login = useCallback(async (name: string, passphrase: string) => {
    const { user } = await api.login(name, passphrase);
    setUser(user);
    setStatus("authed");
  }, []);

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

  const finishAuth = useCallback((u: SelfUser) => {
    setUser(u);
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus("guest");
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ status, user, setUser, login, register, recover, resetVerify, finishAuth, logout }),
    [status, user, login, register, recover, resetVerify, finishAuth, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
