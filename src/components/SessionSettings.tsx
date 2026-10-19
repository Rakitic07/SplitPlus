import { useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import type { SessionPolicy } from "@shared/types";

const POLICIES: { value: SessionPolicy; label: string; hint: string }[] = [
  {
    value: "6months",
    label: "After 6 months",
    hint: "You'll be signed out if you don't open Split+ for 6 months.",
  },
  {
    value: "never",
    label: "Never",
    hint: "Stay signed in on your devices until you log out yourself.",
  },
];

// "Stay signed in" preference + a kill switch for every session. Saves
// immediately rather than waiting for the settings form's Save button.
export function SessionSettings() {
  const { user, updateSettings, logoutAll } = useAuth();
  const { success, error } = useToast();
  const [saving, setSaving] = useState<SessionPolicy | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const policy = user?.sessionPolicy ?? "6months";
  const current = POLICIES.find((p) => p.value === policy) ?? POLICIES[0];

  async function choose(next: SessionPolicy) {
    if (next === policy || saving) return;
    setSaving(next);
    try {
      await updateSettings({ sessionPolicy: next });
      success(next === "never" ? "You'll stay signed in" : "Auto sign-out set to 6 months");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't update that setting");
    } finally {
      setSaving(null);
    }
  }

  async function signOutEverywhere() {
    setLeaving(true);
    try {
      await logoutAll();
      success("Logged out of all devices");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't log out everywhere");
      setLeaving(false);
    }
  }

  return (
    <Field label="Automatically sign me out" group hint={current.hint}>
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1">
        {POLICIES.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => choose(p.value)}
            disabled={!!saving}
            className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
              policy === p.value ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
            } ${saving === p.value ? "animate-pulse" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        {confirming ? (
          <div className="space-y-3">
            <p className="text-sm text-white/70">
              This signs you out everywhere, including this device. You'll need your passphrase to
              log back in.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setConfirming(false)} disabled={leaving}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" loading={leaving} onClick={signOutEverywhere}>
                Log out all
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
              <LogOut className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">Log out of all devices</span>
              <span className="block text-xs text-white/45">
                Lost a phone or used a shared computer? End every session.
              </span>
            </span>
            <ShieldCheck className="h-4 w-4 shrink-0 text-white/30" />
          </button>
        )}
      </div>
    </Field>
  );
}
