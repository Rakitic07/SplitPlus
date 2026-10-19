import { useEffect, useState } from "react";
import { Mail, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Field, Input, PasswordInput } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";

type Mode = "view" | "edit" | "code" | "remove";

// Settings row for the optional recovery email. Adding/changing it needs the
// current passphrase + a 6-digit code sent to the new address; once verified
// it can be used for "Forgot passphrase" and as a login identifier.
export function RecoveryEmailField({ open }: { open: boolean }) {
  const { user, setUser } = useAuth();
  const { success, error } = useToast();
  const [mode, setMode] = useState<Mode>("view");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("view");
    setEmail("");
    setPass("");
    setCode("");
  }, [open]);

  const fail = (err: unknown) => error(err instanceof ApiError ? err.message : "Something went wrong");

  async function sendCode() {
    if (!email.trim() || !pass) return error("Enter the email and your current passphrase");
    setBusy(true);
    try {
      const r = await api.emailStart(email.trim(), pass);
      setSentTo(r.sentTo);
      setCode("");
      setMode("code");
      success(`Code sent to ${r.sentTo}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const { user: updated } = await api.emailVerify(code.trim());
      setUser(updated);
      setPass("");
      setMode("view");
      success("Recovery email saved");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pass) return error("Enter your current passphrase");
    setBusy(true);
    try {
      const { user: updated } = await api.emailRemove(pass);
      setUser(updated);
      setPass("");
      setMode("view");
      success("Recovery email removed");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field
      label="Recovery email"
      group={mode === "view"}
      hint={
        mode === "view"
          ? user?.email
            ? "Used to reset your passphrase. You can also log in with it."
            : "Optional. Lets you reset a forgotten passphrase by email, and log in with it."
          : undefined
      }
    >
      {mode === "view" && (
        <div className="flex items-center gap-2">
          <div className="glass-input flex min-w-0 flex-1 items-center gap-2 !py-2.5">
            {user?.email ? (
              <>
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="truncate text-white">{user.email}</span>
              </>
            ) : (
              <span className="text-white/40">Not set</span>
            )}
          </div>
          <Button variant="ghost" className="!px-3" onClick={() => setMode("edit")}>
            <Mail className="h-4 w-4" /> {user?.email ? "Change" : "Add"}
          </Button>
          {user?.email && (
            <Button variant="ghost" className="!px-3" title="Remove" onClick={() => setMode("remove")}>
              <Trash2 className="h-4 w-4 text-rose-300" />
            </Button>
          )}
        </div>
      )}

      {mode === "edit" && (
        <div className="space-y-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
          <PasswordInput
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Current passphrase"
            autoComplete="current-password"
          />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button className="flex-1" loading={busy} onClick={sendCode}>
              Send code
            </Button>
          </div>
        </div>
      )}

      {mode === "code" && (
        <div className="space-y-2">
          <p className="text-xs text-white/55">
            Enter the 6-digit code we sent to <b className="text-white/80">{sentTo}</b>. Check spam too.
          </p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="font-mono text-lg tracking-[0.4em]"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={sendCode}>
              Resend
            </Button>
            <Button className="flex-1" loading={busy} disabled={code.length !== 6} onClick={verify}>
              Verify
            </Button>
          </div>
        </div>
      )}

      {mode === "remove" && (
        <div className="space-y-2">
          <p className="text-xs text-white/55">
            Without a recovery email you'll only be able to log in with your name.
          </p>
          <PasswordInput
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Current passphrase"
            autoComplete="current-password"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" loading={busy} onClick={remove}>
              Remove email
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}
