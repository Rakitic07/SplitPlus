import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, Field, PasswordInput } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/state/toast";

// Settings row to change the passphrase while signed in. Needs the current
// one; other devices are signed out, this one stays signed in.
export function PassphraseField({ open }: { open: boolean }) {
  const { success, error } = useToast();
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setEditing(false);
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  async function save() {
    if (!current) return error("Enter your current passphrase");
    if (next.length < 6) return error("New passphrase must be at least 6 characters");
    if (next !== confirm) return error("The new passphrases don't match");
    if (next === current) return error("New passphrase must be different from the current one");
    setBusy(true);
    try {
      await api.changePassphrase(current, next);
      reset();
      success("Passphrase changed. Other devices were signed out.");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't change passphrase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field
      label="Passphrase"
      group={!editing}
      hint={editing ? "At least 6 characters. Other devices will be signed out." : undefined}
    >
      {editing ? (
        <div className="space-y-2">
          <PasswordInput
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current passphrase"
            autoComplete="current-password"
            autoFocus
          />
          <PasswordInput
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New passphrase"
            autoComplete="new-password"
          />
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new passphrase"
            autoComplete="new-password"
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={reset}>
              Cancel
            </Button>
            <Button className="flex-1" loading={busy} onClick={save}>
              Update
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="glass-input flex min-w-0 flex-1 items-center !py-2.5 tracking-[0.3em] text-white/50">
            ••••••••
          </div>
          <Button variant="ghost" className="!px-3" onClick={() => setEditing(true)}>
            <KeyRound className="h-4 w-4" /> Change
          </Button>
        </div>
      )}
    </Field>
  );
}
