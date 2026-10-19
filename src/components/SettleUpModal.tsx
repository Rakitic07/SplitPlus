import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, HandCoins, ImagePlus, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { formatMoney } from "@shared/currency";
import { api, ApiError } from "@/lib/api";
import { fileToThumbnail } from "@/lib/utils";
import { useToast } from "@/state/toast";
import type { Debt, GroupDetail } from "@shared/types";

type Direction = "pay" | "receive";

export function SettleUpModal({
  open,
  onClose,
  group,
  debts,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetail;
  debts: Debt[];
  onDone: () => void;
}) {
  const { success, error } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // What I owe each person ("pay") and what each person owes me ("receive"),
  // keyed by the other person's id.
  const iOwe = useMemo(() => {
    const m = new Map<string, number>();
    debts.filter((d) => d.fromId === group.myUserId).forEach((d) => m.set(d.toId, d.amount));
    return m;
  }, [debts, group.myUserId]);
  const owesMe = useMemo(() => {
    const m = new Map<string, number>();
    debts.filter((d) => d.toId === group.myUserId).forEach((d) => m.set(d.fromId, d.amount));
    return m;
  }, [debts, group.myUserId]);
  const others = group.members.filter((m) => m.id !== group.myUserId);

  const [direction, setDirection] = useState<Direction>(
    iOwe.size === 0 && owesMe.size > 0 ? "receive" : "pay"
  );
  const owedFor = (dir: Direction) => (dir === "pay" ? iOwe : owesMe);
  const firstTarget = (dir: Direction) => [...owedFor(dir).keys()][0] ?? others[0]?.id ?? "";

  const [otherId, setOtherId] = useState<string>(() => firstTarget(direction));
  const [amount, setAmount] = useState<string>(() => {
    const v = owedFor(direction).get(firstTarget(direction));
    return v ? String(v) : "";
  });
  const [note, setNote] = useState("");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-derive defaults from the latest balances every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const dir: Direction = iOwe.size === 0 && owesMe.size > 0 ? "receive" : "pay";
    setDirection(dir);
    pickPerson(firstTarget(dir), dir);
    setNote("");
    setThumbnail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pickPerson(id: string, dir = direction) {
    setOtherId(id);
    const v = owedFor(dir).get(id);
    setAmount(v ? String(v) : "");
  }

  function switchDirection(dir: Direction) {
    if (dir === direction) return;
    setDirection(dir);
    pickPerson(owedFor(dir).has(otherId) ? otherId : firstTarget(dir), dir);
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setThumbnail(await fileToThumbnail(file, 1000, 0.7));
    } catch {
      error("Couldn't process that image");
    }
  }

  const receiving = direction === "receive";

  async function submit() {
    const amt = Number(amount) || 0;
    if (!otherId) return error(receiving ? "Choose who paid you" : "Choose who you're paying");
    if (amt <= 0) return error("Enter a valid amount");
    setBusy(true);
    try {
      await api.createSettlement(group.id, {
        toId: otherId,
        direction,
        amount: amt,
        note: note.trim(),
        thumbnail: thumbnail || "",
      });
      success(
        receiving
          ? "Payment received — balances updated"
          : "Payment recorded — waiting for their confirmation"
      );
      onDone();
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't record payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settle up"
      footer={
        <Button className="w-full" loading={busy} onClick={submit}>
          <HandCoins className="h-4 w-4" /> {receiving ? "Record money received" : "Record payment"}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-black/25 p-1">
          {(
            [
              ["pay", "I paid", ArrowUpRight],
              ["receive", "I received", ArrowDownLeft],
            ] as const
          ).map(([dir, label, Icon]) => (
            <button
              key={dir}
              type="button"
              onClick={() => switchDirection(dir)}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition ${
                direction === dir ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        <p className="text-sm text-white/55">
          {receiving
            ? "Record money someone paid you. Since you're the one receiving it, balances update right away."
            : "Record a payment you made. It only affects balances once the recipient confirms they got it."}
        </p>

        <Field label={receiving ? "Who paid you" : "You're paying"} group>
          <div className="flex flex-wrap gap-2">
            {others.map((m) => {
              const owed = owedFor(direction).get(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickPerson(m.id)}
                  className={`flex items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3 text-sm transition ${
                    otherId === m.id ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-white/60"
                  }`}
                >
                  <Avatar name={m.name} src={m.avatar} size={26} />
                  <span>
                    {m.name}
                    {owed !== undefined && (
                      <span className={`ml-1 text-xs ${receiving ? "text-emerald-300" : "text-rose-300"}`}>
                        ({receiving ? "owes you" : "owe"} {formatMoney(group.currency, owed)})
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={`Amount (${group.currency})`}>
          <Input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </Field>

        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="UPI ref, cash, etc." />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-white/70">Payment proof (optional)</span>
          {thumbnail ? (
            <div className="relative inline-block">
              <img src={thumbnail} alt="proof" className="h-28 rounded-2xl object-cover" />
              <button
                type="button"
                onClick={() => setThumbnail(null)}
                aria-label="Remove proof"
                className="absolute -right-2 -top-2 rounded-full bg-rose-500 p-1.5 text-white shadow"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-20 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/5 text-sm text-white/50 transition hover:bg-white/10"
            >
              <ImagePlus className="h-5 w-5" /> Attach a screenshot
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        </div>
      </div>
    </Modal>
  );
}
