import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, loadAuthToken } from "../lib/api";
import type { PublicUser } from "../shared/types";

type Status = "loading" | "authed" | "guest";

type AuthCtx = {
  status: Status;
  user: PublicUser | null;
  login: (name: string, passphrase: string) => Promise<void>;
  register: (name: string, passphrase: string) => Promise<{ recoveryCode: string }>;
  recover: (name: string, code: string, passphrase: string) => Promise<{ recoveryCode: string }>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<PublicUser | null>(null);

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

  const register = useCallback(async (name: string, passphrase: string) => {
    const { user, recoveryCode } = await api.register(name, passphrase);
    setUser(user);
    setStatus("authed");
    return { recoveryCode };
  }, []);

  const recover = useCallback(async (name: string, code: string, passphrase: string) => {
    const { user, recoveryCode } = await api.recover(name, code, passphrase);
    setUser(user);
    setStatus("authed");
    return { recoveryCode };
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus("guest");
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ status, user, login, register, recover, logout }),
    [status, user, login, register, recover, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
