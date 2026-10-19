import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "./state/auth";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { LogoMark } from "./components/Logo";

// A tab left open across a deploy asks for chunk files that no longer exist;
// reload once to pick up the new build instead of showing a broken screen.
const CHUNK_RELOAD_KEY = "splitplus_chunk_reload";
function reloadOnStaleChunk<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().then(
      (mod) => {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return mod;
      },
      (err) => {
        if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) throw err;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        window.location.reload();
        return new Promise<T>(() => {});
      }
    );
}

// Charts (recharts, d3-force) and the admin panel are heavy and not needed for
// the first screen, so they load as separate chunks.
const loadGroupPage = reloadOnStaleChunk(() => import("./pages/GroupPage"));
const GroupPage = lazy(() => loadGroupPage().then((m) => ({ default: m.GroupPage })));
const AdminPage = lazy(
  reloadOnStaleChunk(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })))
);
const JoinPage = lazy(
  reloadOnStaleChunk(() => import("./pages/JoinPage").then((m) => ({ default: m.JoinPage })))
);

// The branded splash — a springy logo pop, a floating/breathing mark, the
// shimmering wordmark, and a shimmering progress bar. Shown on cold-start while
// the session is restored, and again for a beat right after sign-in (mirrors
// the phone app's launch animation) when rendered as an `overlay`.
function Splash({ overlay = false }: { overlay?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.45 } }}
      transition={{ duration: 0.3 }}
      className={
        overlay
          ? "fixed inset-0 z-[60] flex min-h-screen flex-col items-center justify-center bg-app"
          : "flex min-h-screen flex-col items-center justify-center"
      }
    >
      {/* soft warm glow behind the mark */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 15 }}
        className="relative flex flex-col items-center text-center"
      >
        <div className="pointer-events-none absolute -top-10 h-40 w-40 rounded-full bg-orange-500/25 blur-3xl" />
        <div className="logo-float relative">
          <div className="drop-shadow-[0_12px_44px_rgba(255,138,61,0.5)]">
            <LogoMark size={78} />
          </div>
        </div>
        <div className="mt-5 text-4xl font-black tracking-tight gradient-text-shimmer">Split+</div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mt-2 text-sm text-white/50"
        >
          Splitting bills, beautifully.
        </motion.div>
        <div className="skeleton mt-6 h-1 w-24 rounded-full" />
      </motion.div>
    </motion.div>
  );
}

export default function App() {
  const { status } = useAuth();

  // Play a short branded welcome splash when the user transitions from signed
  // out → signed in (a fresh login / finished sign-up), just like the phone app
  // shows its wordmark on launch.
  const [welcome, setWelcome] = useState(false);
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "guest" && status === "authed") {
      setWelcome(true);
      const t = setTimeout(() => setWelcome(false), 1500);
      prevStatus.current = status;
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status]);

  // Warm the group screen chunk once signed in, so opening a group is instant.
  useEffect(() => {
    if (status !== "authed") return;
    const t = setTimeout(() => void import("./pages/GroupPage").catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [status]);

  if (status === "loading") return <Splash />;

  // /admin is a standalone, secret-gated panel — reachable whether or not the
  // visitor is signed in to a normal account.
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        {/* Shareable group join links work in BOTH states: a signed-out visitor
            sees the auth screen (then auto-joins), a signed-in one joins directly. */}
        <Route path="/join/:token" element={<JoinPage />} />
        {status === "guest" ? (
          <Route path="*" element={<AuthPage />} />
        ) : (
          <>
            <Route path="/" element={<HomePage />} />
            <Route path="/g/:groupId" element={<GroupPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>

      <AnimatePresence>{welcome && <Splash key="welcome" overlay />}</AnimatePresence>
    </Suspense>
  );
}
