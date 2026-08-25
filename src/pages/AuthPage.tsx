import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Copy, Download, Github, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button, Card, Field, Input, PasswordInput } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { ShimmerHeading } from "@/components/Shimmer";
import { RecoverModal } from "@/components/RecoverModal";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import { ApiError } from "@/lib/api";
import { REPO_URL, RELEASE_APK_URL } from "@shared/appVersion";
import type { SelfUser } from "@shared/types";

type Mode = "login" | "register";

export function AuthPage({ notice }: { notice?: string } = {}) {
  const { login, register, finishAuth } = useAuth();
  const { success, error } = useToast();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  // After sign-up we hold the account + one-time code until the user saves it.
  const [pending, setPending] = useState<{ user: SelfUser; recoveryCode: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        await login(name, passphrase);
        success(`Welcome back, ${name}!`);
      } else {
        const { user, recoveryCode } = await register(name, passphrase);
        setPending({ user, recoveryCode });
      }
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Card strong className="p-6 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-emerald-400" />
            <h1 className="mt-3 text-xl font-bold">Save your recovery code</h1>
            <p className="mt-1 text-sm text-white/60">
              This is shown once. You'll need it to reset your passphrase if you ever forget it.
            </p>
            <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black/30 px-4 py-3">
              <code className="select-all font-mono text-lg font-bold tracking-widest text-white">
                {pending.recoveryCode}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(pending.recoveryCode).then(() => success("Copied"));
                }}
                className="rounded-xl p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <Copy className="h-5 w-5" />
              </button>
            </div>
            <Button className="mt-6 w-full" onClick={() => finishAuth(pending.user)}>
              I've saved it — continue
            </Button>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={60} className="mb-3" />
          <div className="text-5xl font-black tracking-tight gradient-text-shimmer">Split+</div>
          <p className="mt-2 text-sm text-white/55">
            <ShimmerHeading>Create groups. Split any bill. Settle up with confidence.</ShimmerHeading>
          </p>
        </div>

        {notice && (
          <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center text-sm font-semibold text-amber-200">
            {notice}
          </div>
        )}

        <Card strong className="p-6">
          <div className="mb-5 flex gap-1 rounded-2xl border border-white/10 bg-black/20 p-1">
            {(["login", "register"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  mode === m ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                }`}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Your name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Raktim"
                autoCapitalize="words"
                required
              />
            </Field>

            <Field
              label="Passphrase"
              hint={mode === "register" ? "At least 6 characters. This keeps your account private." : undefined}
            >
              <PasswordInput
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="••••••••"
                required
              />
            </Field>

            <Button type="submit" loading={busy} className="w-full">
              {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {mode === "login" ? "Log in" : "Create account"}
            </Button>
          </form>

          {mode === "login" && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setRecoverOpen(true)}
                className="text-xs text-white/55 underline-offset-2 transition hover:text-white/85 hover:underline"
              >
                Forgot your passphrase?
              </button>
            </div>
          )}
        </Card>

        <p className="mt-5 text-center text-xs text-white/35">
          No email needed. Your name + passphrase is your account — invite friends by their name.
        </p>

        <div className="mt-4 flex items-center justify-center gap-4">
          {/* GitHub repo */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="View source on GitHub"
            aria-label="GitHub repository"
            className="inline-flex items-center text-white/30 transition hover:text-white/60"
          >
            <Github className="h-4 w-4" />
          </a>
          {/* Download the Android app (latest GitHub release APK) */}
          <a
            href={RELEASE_APK_URL}
            className="inline-flex items-center gap-1.5 text-xs text-white/30 underline-offset-2 transition hover:text-white/60 hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> Download app
          </a>
          {/* Admin panel */}
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-xs text-white/30 underline-offset-2 transition hover:text-white/60 hover:underline"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Admin panel
          </Link>
        </div>
      </motion.div>

      <RecoverModal open={recoverOpen} onClose={() => setRecoverOpen(false)} />
    </div>
  );
}
