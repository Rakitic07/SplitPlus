import { Crown, Shield } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Avatar } from "@/components/ui";
import type { GroupMember, Role } from "@shared/types";

function RoleTag({ role }: { role: Role }) {
  if (role === "owner") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
        <Crown className="h-3 w-3" /> Owner
      </span>
    );
  }
  if (role === "moderator") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-orange-400/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300">
        <Shield className="h-3 w-3" /> Mod
      </span>
    );
  }
  return <span className="text-[10px] font-medium uppercase tracking-wide text-white/30">Member</span>;
}

// A quick read-only roster of everyone in the group, opened from the "N members"
// count in the group header. Owners first, then mods, then members.
export function MembersModal({
  open,
  onClose,
  members,
  myUserId,
}: {
  open: boolean;
  onClose: () => void;
  members: GroupMember[];
  myUserId: string;
}) {
  const rank: Record<Role, number> = { owner: 0, moderator: 1, member: 2 };
  const sorted = [...members].sort(
    (a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name)
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Members · ${members.length}`}
    >
      <div className="space-y-1">
        {sorted.map((m) => {
          const isSelf = m.id === myUserId;
          return (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl px-1 py-2">
              <Avatar name={m.name} src={m.avatar} size={40} />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-semibold text-white/90">
                  {m.name}
                  {isSelf && <span className="text-white/40"> (You)</span>}
                </span>
              </div>
              <RoleTag role={m.role} />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
