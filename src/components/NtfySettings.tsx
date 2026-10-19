import { useEffect, useState } from "react";
import { BellRing, Check, Copy, RefreshCw, Send } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";

const DEFAULT_SERVER = "https://ntfy.sh";
const ANDROID_URL = "https://play.google.com/store/apps/details?id=io.heckel.ntfy";
const IOS_URL = "https://apps.apple.com/app/ntfy/id1625396347";

// Anyone who knows a topic on ntfy.sh can read it, so suggest a long random one.
function randomTopic() {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `splitplus-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

// Settings card: optional push notifications for settlements through the ntfy
// app (free, no account). Mirrors the mobile NtfySection.
export function NtfySettings({ open }: { open: boolean }) {
  const { user, setUser } = useAuth();
  const { success, error } = useToast();
  const saved = user?.ntfy ?? null;
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState("");
  const [server, setServer] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "test" | "off">(null);
  const [copied, setCopied] = useState(false);

  const startEditing = () => {
    setTopic(saved?.topic ?? randomTopic());
    const custom = saved && saved.server !== DEFAULT_SERVER ? saved.server : "";
    setServer(custom);
    setShowServer(!!custom);
    setEditing(true);
  };

  useEffect(() => {
    if (open) setEditing(false);
  }, [open]);

  const fail = (err: unknown) => error(err instanceof ApiError ? err.message : "Something went wrong");

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      error("Couldn't copy. Select the topic and copy it manually.");
    }
  }

  async function test() {
    setBusy("test");
    try {
      if (editing) await api.ntfyTest(topic.trim(), server.trim());
      else await api.ntfyTest();
      success("Test sent. Check your phone.");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const { user: updated } = await api.ntfySave(topic.trim(), server.trim());
      setUser(updated);
      setEditing(false);
      success("Phone notifications are on");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function turnOff() {
    setBusy("off");
    try {
      const { user: updated } = await api.ntfyRemove();
      setUser(updated);
      success("Phone notifications turned off");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  const shownServer = editing ? server.trim() || DEFAULT_SERVER : saved?.server ?? DEFAULT_SERVER;
  const shownTopic = editing ? topic.trim() : saved?.topic ?? "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500/20 text-orange-300">
          <BellRing className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            Phone notifications
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/55">
              ntfy · optional
            </span>
          </span>
          <span className="block text-xs text-white/45">
            {saved ? "On. You'll get a push for every settlement." : "Get a push when someone pays you or confirms your payment."}
          </span>
        </span>
        {!editing && (
          <Button variant="ghost" className="!px-3 !py-2 text-sm" onClick={startEditing}>
            {saved ? "Change" : "Set up"}
          </Button>
        )}
      </div>

      {!editing && saved && (
        <div className="space-y-2 border-t border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <code className="glass-input min-w-0 flex-1 truncate !py-2 font-mono text-xs text-white/80">
              {saved.topic}
            </code>
            <Button variant="ghost" className="!px-3" title="Copy topic" onClick={() => copy(saved.topic)}>
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" loading={busy === "test"} onClick={test}>
              <Send className="h-4 w-4" /> Send test
            </Button>
            <Button variant="danger" className="flex-1" loading={busy === "off"} onClick={turnOff}>
              Turn off
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-3 border-t border-white/10 px-4 py-3">
          <ol className="space-y-2 text-xs leading-relaxed text-white/65">
            <li className="flex gap-2">
              <Step n={1} />
              <span>
                Install the free <b className="text-white/85">ntfy</b> app:{" "}
                <a href={ANDROID_URL} target="_blank" rel="noreferrer" className="font-semibold text-orange-300 hover:underline">
                  Android
                </a>{" "}
                ·{" "}
                <a href={IOS_URL} target="_blank" rel="noreferrer" className="font-semibold text-orange-300 hover:underline">
                  iPhone
                </a>
                . No account needed.
              </span>
            </li>
            <li className="flex gap-2">
              <Step n={2} />
              <span>
                In ntfy, tap <b className="text-white/85">+</b> (Subscribe to topic) and paste the topic below.
                {shownServer === DEFAULT_SERVER
                  ? " Leave “Use another server” off."
                  : ` Turn on “Use another server” and enter ${shownServer}.`}
              </span>
            </li>
            <li className="flex gap-2">
              <Step n={3} />
              <span>
                Tap <b className="text-white/85">Send test</b>. A banner should pop up on your phone within a few seconds.
                Then tap <b className="text-white/85">Save</b>.
              </span>
            </li>
          </ol>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-white/60">Your topic</div>
            <div className="flex gap-2">
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value.replace(/\s/g, ""))}
                placeholder="splitplus-…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 font-mono text-sm"
              />
              <Button variant="ghost" className="!px-3" title="Copy topic" onClick={() => copy(shownTopic)}>
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" className="!px-3" title="New random topic" onClick={() => setTopic(randomTopic())}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-amber-200/70">
              Anyone who knows this topic can read these notifications. Keep it private; the random one is safest.
            </p>
          </div>

          {showServer ? (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-white/60">Self-hosted server (optional)</div>
              <Input
                value={server}
                onChange={(e) => setServer(e.target.value.trim())}
                placeholder={DEFAULT_SERVER}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="text-sm"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowServer(true)}
              className="text-xs font-semibold text-white/45 transition hover:text-white/75"
            >
              Using your own ntfy server?
            </button>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" className="!px-3" disabled={!!busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="ghost" className="flex-1" loading={busy === "test"} disabled={!topic.trim()} onClick={test}>
              <Send className="h-4 w-4" /> Send test
            </Button>
            <Button className="flex-1" loading={busy === "save"} disabled={!topic.trim()} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-500/25 text-[10px] font-bold text-orange-200">
      {n}
    </span>
  );
}
