import { useEffect, useRef, useState } from "react";
import { Crop, ImagePlus, Loader2, Search, Trash2, UserPlus, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { ImageCropper } from "@/components/ImageCropper";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { CURRENCIES } from "@shared/currency";
import { GROUP_EMOJIS } from "@shared/categories";
import { api, ApiError } from "@/lib/api";
import { fileToDataURL } from "@/lib/utils";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import type { GroupSummary, PublicUser } from "@shared/types";

export function CreateGroupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (g: GroupSummary) => void;
}) {
  const { user } = useAuth();
  const { success, error } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(GROUP_EMOJIS[0]);
  const [currency, setCurrency] = useState(user?.defaultCurrency ?? "INR");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  // Invite-as-you-create.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [invitees, setInvitees] = useState<PublicUser[]>([]);

  // Sync the default currency whenever the modal (re)opens.
  useEffect(() => {
    if (open) setCurrency(user?.defaultCurrency ?? "INR");
  }, [open, user?.defaultCurrency]);

  // Debounced user search — only after 3 characters.
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api
        .searchUsers(query.trim())
        .then((r) => setResults(r.users))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function reset() {
    setName("");
    setEmoji(GROUP_EMOJIS[0]);
    setCurrency(user?.defaultCurrency ?? "INR");
    setThumbnail(null);
    setCropSrc(null);
    setCropOpen(false);
    setQuery("");
    setResults([]);
    setInvitees([]);
  }

  function addInvitee(u: PublicUser) {
    setInvitees((prev) => (prev.some((p) => p.id === u.id) ? prev : [...prev, u]));
    setQuery("");
    setResults([]);
  }
  function removeInvitee(id: string) {
    setInvitees((prev) => prev.filter((p) => p.id !== id));
  }

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

  async function create() {
    if (!name.trim()) return error("Give your group a name");
    setBusy(true);
    try {
      const { group, invited } = await api.createGroup({
        name: name.trim(),
        emoji,
        currency,
        thumbnail: thumbnail || "",
        inviteeIds: invitees.map((u) => u.id),
      });
      success(
        invited > 0
          ? `Group "${group.name}" created · ${invited} ${invited === 1 ? "invite" : "invites"} sent`
          : `Group "${group.name}" created`
      );
      onCreated(group);
      reset();
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't create group");
    } finally {
      setBusy(false);
    }
  }

  const filteredResults = results.filter((u) => !invitees.some((p) => p.id === u.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New group"
      footer={
        <Button className="w-full" loading={busy} onClick={create}>
          Create group
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
              <span className="text-xs">Add a cover photo (optional)</span>
            </div>
          )}
          <span className="absolute left-3 top-3 text-3xl drop-shadow">{emoji}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />

        {thumbnail && (
          <div className="-mt-2 flex items-center gap-4">
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
            <button
              type="button"
              onClick={() => setThumbnail(null)}
              className="flex items-center gap-1.5 text-xs text-rose-400/70 transition hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        )}

        <Field label="Group name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Goa Trip 2026"
            autoFocus
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

        {/* Invite members */}
        <Field
          label="Invite members (optional)"
          hint="Type at least 3 letters of a name. They'll get an invite to accept."
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="!pl-10"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" />
            )}
          </div>
        </Field>

        {filteredResults.length > 0 && (
          <div className="-mt-2 space-y-1.5">
            {filteredResults.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => addInvitee(u)}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
              >
                <Avatar name={u.name} src={u.avatar} size={32} />
                <span className="flex-1 truncate text-sm font-semibold text-white/85">{u.name}</span>
                <UserPlus className="h-4 w-4 text-orange-300" />
              </button>
            ))}
          </div>
        )}

        {query.trim().length >= 3 && !searching && filteredResults.length === 0 && (
          <p className="-mt-2 text-center text-xs text-white/40">
            No one found. They need to log in to Split+ once first.
          </p>
        )}

        {invitees.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {invitees.map((u) => (
              <span
                key={u.id}
                className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-1 pr-2 text-sm text-white/85"
              >
                <Avatar name={u.name} src={u.avatar} size={22} />
                {u.name}
                <button
                  type="button"
                  onClick={() => removeInvitee(u.id)}
                  className="text-white/50 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
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
