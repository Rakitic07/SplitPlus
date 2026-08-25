import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { AuthPage } from "@/pages/AuthPage";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import { api, ApiError } from "@/lib/api";

type Preview = { id: string; name: string; emoji: string | null; memberCount: number };

// Landing page for a shareable group "join link" (/join/:token). If the visitor
// isn't signed in yet we show the normal auth screen (with a "you're joining X"
// banner); the moment they authenticate the app re-renders into the signed-in
// branch, this page mounts again, and we auto-join → redirect into the group.
export function JoinPage() {
  const { token = "" } = useParams();
  const { status } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const joinedRef = useRef(false);

  // Preview the group behind the link (works even while signed out).
  useEffect(() => {
    let alive = true;
    api
      .joinPreview(token)
      .then((r) => alive && setPreview(r.group))
      .catch(() => alive && setInvalid(true));
    return () => {
      alive = false;
    };
  }, [token]);

  // Once signed in, join and jump straight into the group. Guard so a re-render
  // can't fire the join twice.
  useEffect(() => {
    if (status !== "authed" || joinedRef.current || invalid) return;
    joinedRef.current = true;
    api
      .joinGroup(token)
      .then((r) => {
        if (!r.alreadyMember) success("You're in! 🎉");
        navigate(`/g/${r.groupId}`, { replace: true });
      })
      .catch((err) => {
        joinedRef.current = false;
        setInvalid(true);
        toastError(err instanceof ApiError ? err.message : "Couldn't join this group");
      });
  }, [status, token, invalid, navigate, success, toastError]);

  if (invalid) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <Card strong className="p-6 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
            <h1 className="mt-3 text-xl font-bold">Invite link not working</h1>
            <p className="mt-1 text-sm text-white/60">
              This link is invalid or has expired. Ask whoever shared it for a fresh one.
            </p>
            <Button className="mt-6 w-full" onClick={() => navigate("/", { replace: true })}>
              Go to Split+
            </Button>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Not signed in yet → show auth with a contextual banner. After they log in or
  // sign up the app flips to the authed branch and this page auto-joins.
  if (status === "guest") {
    const label = preview ? `${preview.emoji ? preview.emoji + " " : ""}${preview.name}` : "a group";
    return <AuthPage notice={`Sign in or create your account to join "${label}".`} />;
  }

  // Authed (or still loading auth) → joining splash.
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <motion.div
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
      >
        <LogoMark size={64} />
      </motion.div>
      <div className="mt-4 text-2xl font-black tracking-tight gradient-text-shimmer">
        Joining {preview ? preview.name : "…"}
      </div>
      <div className="mt-2 text-sm text-white/50">Setting you up…</div>
    </div>
  );
}
