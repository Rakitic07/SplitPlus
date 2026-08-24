import { useEffect, useState } from "react";
import { Clock, Copy, MessageCircle, Search, UserPlus } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/state/toast";
import type { PublicUser } from "@shared/types";

export function InviteModal({
  open,
  onClose,
  groupId,
  groupName,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName?: string;
}) {
  const { success, error } = useToast();

  // A shareable message pointing friends to the app. There's no public join
  // link (invites are accepted in-app), so this nudges them to sign in and
  // check their invites — great for phone + web via WhatsApp.
  const inviteMessage = `Hey! Join me on Split+${
    groupName ? ` for "${groupName}"` : ""
  } so we can split our expenses. Open ${
    typeof window !== "undefined" ? window.location.origin : "the app"
  }, sign in with your name, and accept the invite from your home screen. 💸`;

  function shareWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(inviteMessage)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(inviteMessage);
      success("Invite message copied");
    } catch {
      error("Couldn't copy");
    }
  }
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [pending, setPending] = useState<{ id: string; invitee: PublicUser }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .groupInvites(groupId)
      .then((r) => setPending(r.invites))
      .catch(() => {});
  }, [open, groupId]);

  // Debounced user search (min 3 chars).
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchUsers(query.trim())
        .then((r) => setResults(r.users))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function invite(u?: PublicUser) {
    const name = u?.name ?? query.trim();
    if (!name) return error("Enter a name");
    setBusy(name);
    try {
      const { invite } = await api.sendInvite(groupId, name);
      setPending((p) => [{ id: invite.id, invitee: invite.invitee }, ...p]);
      setQuery("");
      setResults([]);
      success(`Invited ${invite.invitee.name}`);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't send invite");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite people">
      <div className="space-y-4">
        <Field label="Find someone by name" hint="They must have logged in to Split+ at least once.">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a name…"
              className="!pl-10"
              onKeyDown={(e) => e.key === "Enter" && invite()}
            />
          </div>
        </Field>

        {results.length > 0 && (
          <div className="space-y-1.5">
            {results.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <Avatar name={u.name} src={u.avatar} size={34} />
                <span className="flex-1 truncate text-sm font-semibold text-white/85">{u.name}</span>
                <Button className="!px-3 !py-1.5 text-xs" loading={busy === u.name} onClick={() => invite(u)}>
                  <UserPlus className="h-3.5 w-3.5" /> Invite
                </Button>
              </div>
            ))}
          </div>
        )}

        {query.trim().length >= 3 && results.length === 0 && (
          <p className="text-center text-sm text-white/40">
            No one found. They need to log in once before you can invite them.
          </p>
        )}

        {/* Share via WhatsApp / copy — nudge friends to sign in & accept. */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
            Or share an invite
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={shareWhatsApp}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </button>
            <button
              type="button"
              onClick={copyMessage}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/10"
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
          </div>
        </div>

        {pending.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
              Pending invites
            </div>
            <div className="space-y-1.5">
              {pending.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-1 py-1.5">
                  <Avatar name={p.invitee.name} src={p.invitee.avatar} size={30} />
                  <span className="flex-1 truncate text-sm text-white/70">{p.invitee.name}</span>
                  <span className="flex items-center gap-1 text-xs text-amber-300">
                    <Clock className="h-3 w-3" /> Waiting
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
