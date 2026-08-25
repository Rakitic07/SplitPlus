import { useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { SettingsModal } from "@/components/SettingsModal";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { success } = useToast();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <header className="pt-safe sticky top-0 z-30 border-b border-white/10 bg-[#0a0807]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <button onClick={() => navigate("/")} className="flex items-center">
            <Logo size={30} textClassName="text-2xl" />
          </button>
          <div className="flex items-center gap-2">
            {children}
            {user && (
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3 transition hover:bg-white/10"
                title="Settings"
              >
                <Avatar name={user.name} src={user.avatar} size={28} />
                <span className="hidden text-sm font-semibold text-white/80 sm:block">
                  {user.name}
                </span>
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              title="Settings"
              className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              onClick={() => logout().then(() => success("Logged out"))}
              title="Log out"
              className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Rendered OUTSIDE the header: the header has `backdrop-blur` which would
          otherwise make this fixed-position modal position relative to the
          header box (hiding its top behind the bar). */}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
