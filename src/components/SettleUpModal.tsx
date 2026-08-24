import { useMemo, useRef, useState } from "react";
import { HandCoins, ImagePlus, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { formatMoney } from "@shared/currency";
import { api, ApiError } from "@/lib/api";
import { fileToThumbnail } from "@/lib/utils";
import { useToast } from "@/state/toast";
import type { Debt, GroupDetail } from "@shared/types";

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

  // People I owe, biggest first — the natural settle targets.
  const iOwe = useMemo(
    () => debts.filter((d) => d.fromId === group.myUserId),
    [debts, group.myUserId]
  );
  const others = group.members.filter((m) => m.id !== group.myUserId);

  const [toId, setToId] = useState<string>(iOwe[0]?.toId ?? others[0]?.id ?? "");
  const [amount, setAmount] = useState<string>(iOwe[0] ? String(iOwe[0].amount) : "");
  const [note, setNote] = useState("");
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickRecipient(id: string) {
    setToId(id);
    const owed = iOwe.find((d) => d.toId === id);
    if (owed) setAmount(String(owed.amount));
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setThumbnail(await fileToThumbnail(file, 1000, 0.7));
    } catch {
      error("Couldn't process that image");
    }
  }

  async function submit() {
    const amt = Number(amount) || 0;
    if (!toId) return error("Choose who you're paying");
    if (amt <= 0) return error("Enter a valid amount");
    setBusy(true);
    try {
      await api.createSettlement(group.id, {
        toId,
        amount: amt,
        note: note.trim(),
        thumbnail: thumbnail || "",
      });
      success("Payment recorded — waiting for their confirmation");
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
          <HandCoins className="h-4 w-4" /> Record payment
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-white/55">
          Record a payment you made. It only affects balances once the recipient confirms they got it.
        </p>

        <Field label="You're paying">
          <div className="flex flex-wrap gap-2">
            {others.map((m) => {
              const owed = iOwe.find((d) => d.toId === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickRecipient(m.id)}
                  className={`flex items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3 text-sm transition ${
                    toId === m.id ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-white/60"
                  }`}
                >
                  <Avatar name={m.name} src={m.avatar} size={26} />
                  <span>
                    {m.name}
                    {owed && (
                      <span className="ml-1 text-xs text-rose-300">
                        (owe {formatMoney(group.currency, owed.amount)})
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
