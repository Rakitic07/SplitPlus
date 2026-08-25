import { useEffect, useRef, useState } from "react";
import { Crop, ImagePlus, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { ImageCropper } from "@/components/ImageCropper";
import { Button, Field, Input } from "@/components/ui";
import { CURRENCIES } from "@shared/currency";
import { GROUP_EMOJIS } from "@shared/categories";
import { api, ApiError } from "@/lib/api";
import { fileToDataURL } from "@/lib/utils";
import { useToast } from "@/state/toast";
import type { GroupDetail } from "@shared/types";

// Edit a group's cover photo, emoji, name and currency. Owners and moderators
// only — the server (PATCH /groups/:id) enforces the same rule.
export function EditGroupModal({
  open,
  onClose,
  group,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetail;
  onSaved: () => void;
}) {
  const { success, error } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(group.name);
  const [emoji, setEmoji] = useState<string>(group.emoji ?? GROUP_EMOJIS[0]);
  const [currency, setCurrency] = useState(group.currency);
  // `null` = keep whatever the server has; a data URL = new cover; "" = cleared.
  const [thumbnail, setThumbnail] = useState<string | null>(group.thumbnail ?? null);
  const [busy, setBusy] = useState(false);
  // Source image handed to the cropper (a data URL), and whether it's open.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  // Re-seed the form from the group each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setName(group.name);
    setEmoji(group.emoji ?? GROUP_EMOJIS[0]);
    setCurrency(group.currency);
    setThumbnail(group.thumbnail ?? null);
  }, [open, group]);

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    try {
      const dataUrl = await fileToDataURL(file);
      setCropSrc(dataUrl);
      setCropOpen(true);
    } catch {
      error("Couldn't process that image");
    }
  }

  async function save() {
    if (!name.trim()) return error("Give your group a name");
    setBusy(true);
    try {
      // Only send fields that actually changed. For the cover, send the new
      // data URL, or "" to clear it — but skip it entirely if untouched so we
      // don't re-upload a large base64 blob on every edit.
      const patch: Record<string, string> = {};
      if (name.trim() !== group.name) patch.name = name.trim();
      if (emoji !== (group.emoji ?? "")) patch.emoji = emoji;
      if (currency !== group.currency) patch.currency = currency;
      const originalThumb = group.thumbnail ?? null;
      if (thumbnail !== originalThumb) patch.thumbnail = thumbnail ?? "";

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      await api.updateGroup(group.id, patch);
      success("Group updated");
      onSaved();
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't update group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit group"
      footer={
        <Button className="w-full" loading={busy} onClick={save}>
          Save changes
        </Button>
      }
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative flex h-32 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/20 bg-white/5 transition hover:bg-white/10"
        >
          {thumbnail ? (
            <img src={thumbnail} alt="cover" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-white/50">
              <ImagePlus className="h-6 w-6" />
              <span className="text-xs">Add a cover photo</span>
            </div>
          )}
          <span className="absolute left-3 top-3 text-3xl drop-shadow">{emoji}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />

        {(thumbnail || thumbnail !== (group.thumbnail ?? null)) && (
          <div className="-mt-2 flex flex-wrap items-center gap-4">
            {thumbnail && (
              <button
                type="button"
                onClick={() => {
                  setCropSrc(thumbnail);
                  setCropOpen(true);
                }}
                className="flex items-center gap-1.5 text-xs text-white/50 transition hover:text-white"
              >
                <Crop className="h-3.5 w-3.5" /> Adjust &amp; center
              </button>
            )}
            {thumbnail && (
              <button
                type="button"
                onClick={() => setThumbnail("")}
                className="flex items-center gap-1.5 text-xs text-rose-400/70 transition hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove cover photo
              </button>
            )}
            {thumbnail !== (group.thumbnail ?? null) && (
              <button
                type="button"
                onClick={() => setThumbnail(group.thumbnail ?? null)}
                className="flex items-center gap-1.5 text-xs text-white/50 transition hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset cover
              </button>
            )}
          </div>
        )}

        <Field label="Group name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Goa Trip 2026"
          />
        </Field>

        <Field label="Pick an emoji">
          <div className="flex flex-wrap gap-2">
            {GROUP_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setEmoji(em)}
                className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition ${
                  emoji === em ? "bg-white/20 ring-2 ring-white/50" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                {em}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Currency">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="glass-input appearance-none"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code} className="bg-[#1c1710]">
                {c.symbol} {c.code} — {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-white/60" />
        </div>
      )}

      <ImageCropper
        open={cropOpen}
        src={cropSrc}
        aspect={16 / 9}
        onCancel={() => setCropOpen(false)}
        onDone={(dataUrl) => {
          setThumbnail(dataUrl);
          setCropOpen(false);
        }}
      />
    </Modal>
  );
}
