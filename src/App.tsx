import { Navigate, Route, Routes } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "./state/auth";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { GroupPage } from "./pages/GroupPage";
import { AdminPage } from "./pages/AdminPage";
import { LogoMark } from "./components/Logo";

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 14 }}
        className="flex flex-col items-center text-center"
      >
        <motion.div
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
        >
          <LogoMark size={72} />
        </motion.div>
        <div className="mt-4 text-4xl font-black tracking-tight gradient-text-shimmer">Split+</div>
        <div className="mt-2 text-sm text-white/50">Splitting bills, beautifully.</div>
      </motion.div>
    </div>
  );
}

export default function App() {
  const { status } = useAuth();

  if (status === "loading") return <Splash />;

  // /admin is a standalone, secret-gated panel — reachable whether or not the
  // visitor is signed in to a normal account.
  return (
    <Routes>
      <Route path="/admin" element={<AdminPage />} />
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
  );
}
