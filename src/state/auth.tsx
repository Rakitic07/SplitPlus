import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type ResetAnswers } from "@/lib/api";
import type { SelfUser } from "@shared/types";
import type { SettingsInput } from "@shared/validation";

type Status = "loading" | "authed" | "guest";

type AuthCtx = {
  status: Status;
  user: SelfUser | null;
  login: (name: string, passphrase: string) => Promise<void>;
  register: (
    name: string,
    passphrase: string
  ) => Promise<{ user: SelfUser; recoveryCode: string }>;
  recover: (
    name: string,
    code: string,
    passphrase: string
  ) => Promise<{ user: SelfUser; recoveryCode: string }>;
  resetVerify: (
    name: string,
    passphrase: string,
    answers: ResetAnswers
  ) => Promise<{ user: SelfUser; recoveryCode: string }>;
  // Flip the app into the authed state once the user has acknowledged their
  // one-time recovery code (register/recover intentionally defer this).
  finishAuth: (u: SelfUser) => void;
  logout: () => Promise<void>;
  setUser: (u: SelfUser) => void;
  updateSettings: (patch: Partial<SettingsInput>) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<SelfUser | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => {
        if (!alive) return;
        if (r.authenticated && r.user) {
          setUserState(r.user);
          setStatus("authed");
        } else {
          setStatus("guest");
        }
      })
      .catch(() => alive && setStatus("guest"));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (name: string, passphrase: string) => {
    const { user } = await api.login(name, passphrase);
    setUserState(user);
    setStatus("authed");
  }, []);

  // Register/recover create a server session but keep the app "guest" so the
  // caller can show the one-time recovery code first — then call finishAuth.
  const register = useCallback(async (name: string, passphrase: string) => {
    const { user, recoveryCode } = await api.register(name, passphrase);
    return { user, recoveryCode };
  }, []);

  const recover = useCallback(
    async (name: string, code: string, passphrase: string) => {
      const { user, recoveryCode } = await api.recover(name, code, passphrase);
      return { user, recoveryCode };
    },
    []
  );

  const resetVerify = useCallback(
    async (name: string, passphrase: string, answers: ResetAnswers) => {
      const { user, recoveryCode } = await api.resetVerify(name, passphrase, answers);
      return { user, recoveryCode };
    },
    []
  );

  const finishAuth = useCallback((u: SelfUser) => {
    setUserState(u);
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUserState(null);
    setStatus("guest");
  }, []);

  const setUser = useCallback((u: SelfUser) => setUserState(u), []);

  const updateSettings = useCallback(async (patch: Partial<SettingsInput>) => {
    const { user } = await api.updateSettings(patch);
    setUserState(user);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user,
      login,
      register,
      recover,
      resetVerify,
      finishAuth,
      logout,
      setUser,
      updateSettings,
    }),
    [
      status,
      user,
      login,
      register,
      recover,
      resetVerify,
      finishAuth,
      logout,
      setUser,
      updateSettings,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
