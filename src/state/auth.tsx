import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, onSessionEnded, type ResetAnswers } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import type { SelfUser } from "@shared/types";
import type { SettingsInput } from "@shared/validation";

type Status = "loading" | "authed" | "guest";

type AuthCtx = {
  status: Status;
  user: SelfUser | null;
  login: (nameOrEmail: string, passphrase: string) => Promise<SelfUser>;
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
  logoutAll: () => Promise<void>;
  setUser: (u: SelfUser) => void;
  updateSettings: (patch: Partial<SettingsInput>) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

// Last known profile, so a slow or unreachable server on load doesn't look
// like being logged out.
const USER_KEY = "splitplus_user";

function readCachedUser(): SelfUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SelfUser) : null;
  } catch {
    return null;
  }
}
function writeCachedUser(u: SelfUser | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<SelfUser | null>(null);

  const remember = useCallback((u: SelfUser) => {
    setUserState(u);
    writeCachedUser(u);
  }, []);

  // The theme is a personal setting, so signing out returns to the default.
  const signedOut = useCallback(() => {
    writeCachedUser(null);
    setUserState(null);
    setStatus("guest");
    applyTheme("glass");
  }, []);

  useEffect(() => {
    onSessionEnded(signedOut);
    return () => onSessionEnded(null);
  }, [signedOut]);

  const theme = user?.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const cached = readCachedUser();
    if (cached) {
      setUserState(cached);
      setStatus("authed");
    }
    fetchMe(cached ? 4 : 3)
      .then((r) => {
        if (!alive) return;
        if (r.authenticated && r.user) {
          remember(r.user);
          setStatus("authed");
        } else {
          signedOut();
        }
      })
      // Server unreachable: stay on the cached profile if there is one.
      .catch(() => alive && !cached && setStatus("guest"));
    return () => {
      alive = false;
    };
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

  const updateSettings = useCallback(
    async (patch: Partial<SettingsInput>) => {
      const { user } = await api.updateSettings(patch);
      remember(user);
    },
    [remember]
  );

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
      logoutAll,
      setUser: remember,
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
      logoutAll,
      remember,
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
