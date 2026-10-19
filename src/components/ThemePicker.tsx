import { useState } from "react";
import { Check } from "lucide-react";
import { Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import type { AppTheme } from "@shared/types";

const THEMES: { value: AppTheme; label: string; hint: string }[] = [
  { value: "glass", label: "Liquid glass", hint: "Frosted panels over a warm glow." },
  { value: "neumorph", label: "Neumorph", hint: "Soft, extruded surfaces with gentle depth." },
];

// Previews are drawn with inline styles so each looks right regardless of the
// theme that's currently active.
function Preview({ theme }: { theme: AppTheme }) {
  if (theme === "neumorph") {
    const hi = "rgb(53 58 66)";
    const lo = "rgb(23 25 29)";
    return (
      <div className="flex h-20 items-center justify-center gap-3 rounded-xl" style={{ background: "rgb(38 42 48)" }}>
        <div
          className="h-10 w-14 rounded-xl"
          style={{ background: "rgb(38 42 48)", boxShadow: `4px 4px 9px ${lo}, -4px -4px 9px ${hi}` }}
        />
        <div
          className="h-6 w-6 rounded-full"
          style={{ background: "rgb(38 42 48)", boxShadow: `inset 3px 3px 6px ${lo}, inset -3px -3px 6px ${hi}` }}
        />
      </div>
    );
  }
  return (
    <div
      className="relative flex h-20 items-center justify-center gap-3 overflow-hidden rounded-xl"
      style={{ background: "radial-gradient(120% 120% at 30% 0%, #3a2410, #0a0805 70%)" }}
    >
      <div className="absolute -left-4 -top-4 h-14 w-14 rounded-full bg-orange-500/40 blur-xl" />
      <div
        className="relative h-10 w-14 rounded-xl border border-white/25"
        style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.28), rgba(255,255,255,0.05))" }}
      />
      <div className="relative h-6 w-6 rounded-full" style={{ background: "linear-gradient(135deg,#ff8a3d,#ffc23d)" }} />
    </div>
  );
}

// Saves immediately and applies live; the phone picks it up on next launch.
export function ThemePicker() {
  const { user, updateSettings } = useAuth();
  const { error } = useToast();
  const [saving, setSaving] = useState<AppTheme | null>(null);
  const current = user?.theme ?? "glass";

  async function choose(next: AppTheme) {
    if (next === current || saving) return;
    setSaving(next);
    try {
      await updateSettings({ theme: next });
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't change the theme");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Field label="Theme" group hint={THEMES.find((t) => t.value === current)?.hint}>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => {
          const active = current === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(t.value)}
              disabled={!!saving}
              className={`rounded-2xl border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60 ${
                active ? "border-orange-400/70" : "border-white/10 hover:border-white/25"
              } ${saving === t.value ? "animate-pulse" : ""}`}
            >
              <Preview theme={t.value} />
              <span className="mt-2 flex items-center justify-between px-1 text-sm font-semibold text-white">
                {t.label}
                {active && <Check className="h-4 w-4 text-orange-300" aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}
