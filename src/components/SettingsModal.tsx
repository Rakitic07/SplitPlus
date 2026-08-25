import { useEffect, useRef, useState } from "react";
import { Bell, Check, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { CURRENCIES } from "@shared/currency";
import { api, ApiError, type NameChangeStatus } from "@/lib/api";
import { fileToThumbnail } from "@/lib/utils";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import type { ReminderFrequency } from "@shared/types";

const FREQ: { value: ReminderFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, setUser } = useAuth();
  const { success, error } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null);
  const [defaultCurrency, setDefaultCurrency] = useState(user?.defaultCurrency ?? "INR");
  const [reminderEnabled, setReminderEnabled] = useState(user?.reminderEnabled ?? false);
  const [reminderFrequency, setReminderFrequency] = useState<ReminderFrequency>(
    user?.reminderFrequency ?? "weekly"
  );
  const [busy, setBusy] = useState(false);

  // Display-name editing (rate-limited to 2 / 30 days server-side).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameChangeStatus | null>(null);

  // Reset the form to the latest user values whenever the modal opens.
  useEffect(() => {
    if (!open || !user) return;
    setAvatar(user.avatar ?? null);
    setDefaultCurrency(user.defaultCurrency);
    setReminderEnabled(user.reminderEnabled);
    setReminderFrequency(user.reminderFrequency);
    setEditingName(false);
    setNameDraft(user.name);
    api.nameStatus().then(setNameStatus).catch(() => setNameStatus(null));
  }, [open, user]);

  async function saveName() {
    if (!user) return;
    const next = nameDraft.trim();
    if (!next || next === user.name) {
      setEditingName(false);
      setNameDraft(user.name);
      return;
    }
    setNameBusy(true);
    try {
      const { user: updated, status } = await api.changeName(next);
      setUser(updated);
      setNameStatus(status);
      setEditingName(false);
      success("Name updated");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't change name");
    } finally {
      setNameBusy(false);
    }
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const thumb = await fileToThumbnail(file, 400, 0.8);
      setAvatar(thumb);
    } catch {
      error("Couldn't process that image");
    }
  }

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      const { user: updated } = await api.updateSettings({
        avatar: avatar ?? "",
        defaultCurrency,
        reminderEnabled,
        reminderFrequency,
      });
      setUser(updated);
      success("Settings saved");
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't save settings");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      footer={
        <Button className="w-full" loading={busy} onClick={save}>
          Save changes
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative"
            title="Change photo"
          >
            <Avatar name={user.name} src={avatar} size={72} />
            <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white ring-2 ring-[#0a0807]">
              <ImagePlus className="h-3.5 w-3.5" />
            </span>
          </button>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">{user.name}</div>
            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-xs font-semibold text-orange-300 hover:text-orange-200"
              >
                Change photo
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={() => setAvatar(null)}
                  className="flex items-center gap-1 text-xs text-white/40 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              )}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        </div>

        {/* Display name (rate-limited) */}
        <Field
          label="Display name"
          hint={
            nameStatus
              ? nameStatus.remaining > 0
                ? `${nameStatus.remaining} of ${nameStatus.limit} name changes left in the next ${nameStatus.windowDays} days. Others invite you by this name.`
                : `Limit reached. You can change it again on ${
                    nameStatus.nextChangeAt
                      ? new Date(nameStatus.nextChangeAt).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "later"
                  }.`
              : "You can change your name up to twice a month."
          }
        >
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={40}
                autoFocus
                placeholder="Your name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") {
                    setEditingName(false);
                    setNameDraft(user.name);
                  }
                }}
              />
              <Button className="!px-3" loading={nameBusy} onClick={saveName} title="Save name">
                <Check className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="truncate font-semibold text-white">{user.name}</span>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(user.name);
                  setEditingName(true);
                }}
                disabled={nameStatus?.remaining === 0}
                className="flex shrink-0 items-center gap-1 text-xs font-semibold text-orange-300 transition hover:text-orange-200 disabled:cursor-not-allowed disabled:text-white/30"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            </div>
          )}
        </Field>

        {/* Default currency */}
        <Field
          label="Default currency"
          hint="Pre-selected when you create a new group, so you're not asked every time."
        >
          <select
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            className="glass-input appearance-none"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code} className="bg-[#1c1710]">
                {c.symbol} {c.code} — {c.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Reminders */}
        <div>
          <button
            type="button"
            onClick={() => setReminderEnabled((v) => !v)}
            className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/20 text-orange-300">
              <Bell className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">Settle-up reminders</span>
              <span className="block text-xs text-white/45">
                Nudge me when I have unsettled balances.
              </span>
            </span>
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                reminderEnabled ? "bg-orange-500" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  reminderEnabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </span>
          </button>

          {reminderEnabled && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-semibold text-white/60">How often</div>
              <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1">
                {FREQ.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setReminderFrequency(f.value)}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                      reminderFrequency === f.value
                        ? "bg-white/15 text-white"
                        : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-white/30">
          Member since{" "}
          {user.createdAt
            ? new Date(user.createdAt).toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })
            : "—"}
        </p>
      </div>
    </Modal>
  );
}
