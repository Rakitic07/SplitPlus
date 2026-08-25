import { useMemo, useRef, useState } from "react";
import { Equal, ImagePlus, Percent, ScrollText, SlidersHorizontal, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { CATEGORIES, categoryMeta } from "@shared/categories";
import { formatMoney } from "@shared/currency";
import { computeShares, validateSplit, type ShareInput, type SplitMode } from "@shared/split";
import { api, ApiError } from "@/lib/api";
import { fileToThumbnail, todayInput } from "@/lib/utils";
import { useToast } from "@/state/toast";
import type { Expense, GroupDetail } from "@shared/types";

type ShareState = Record<string, { included: boolean; value: string }>;

const MODES: { key: SplitMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "equal", label: "Equally", icon: <Equal className="h-4 w-4" />, hint: "Split evenly among everyone selected." },
  { key: "exact", label: "Exact", icon: <SlidersHorizontal className="h-4 w-4" />, hint: "Type the exact amount each person owes." },
  { key: "percent", label: "Percent", icon: <Percent className="h-4 w-4" />, hint: "Give each person a % of the bill." },
  { key: "shares", label: "Shares", icon: <ScrollText className="h-4 w-4" />, hint: "Weight it — e.g. 2 shares vs 1 share." },
];

export function ExpenseFormModal({
  open,
  onClose,
  group,
  editing,
  onSaved,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetail;
  editing?: Expense | null;
  onSaved: () => void;
  onDelete?: (expense: Expense) => void;
}) {
  const { success, error } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const initShares = (): ShareState => {
    const st: ShareState = {};
    for (const m of group.members) {
      const share = editing?.shares.find((s) => s.userId === m.id);
      const included = editing ? !!share : true;
      let value = "";
      if (editing && share) {
        if (editing.splitMode === "exact") value = String(share.amount);
        else if (editing.splitMode === "percent")
          value = String(Math.round((share.amount / editing.amount) * 100));
        else if (editing.splitMode === "shares") value = String(share.amount);
      }
      st[m.id] = { included, value };
    }
    return st;
  };

  const [title, setTitle] = useState(editing?.title ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [category, setCategory] = useState(editing?.category ?? CATEGORIES[0].name);
  const [date, setDate] = useState(editing ? editing.date.slice(0, 10) : todayInput());
  const [paidById, setPaidById] = useState(editing?.paidBy.id ?? group.myUserId);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [mode, setMode] = useState<SplitMode>((editing?.splitMode as SplitMode) ?? "equal");
  const [shares, setShares] = useState<ShareState>(initShares);
  const [thumbnail, setThumbnail] = useState<string | null>(editing?.thumbnail ?? null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const amt = Number(amount) || 0;

  const inputs: ShareInput[] = useMemo(
    () =>
      group.members.map((m) => ({
        userId: m.id,
        included: shares[m.id]?.included ?? false,
        value: Number(shares[m.id]?.value) || 0,
      })),
    [group.members, shares]
  );

  const computed = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of computeShares(amt, mode, inputs)) map.set(c.userId, c.amount);
    return map;
  }, [amt, mode, inputs]);

  const splitError = amt > 0 ? validateSplit(amt, mode, inputs) : null;
  const includedCount = inputs.filter((s) => s.included).length;

  function toggle(userId: string) {
    setShares((s) => ({ ...s, [userId]: { ...s[userId], included: !s[userId]?.included } }));
  }
  function setValue(userId: string, value: string) {
    setShares((s) => ({ ...s, [userId]: { ...s[userId], value } }));
  }

  function splitEqualHint() {
    if (mode !== "equal" || includedCount === 0 || amt <= 0) return null;
    return `${formatMoney(group.currency, amt / includedCount)} each`;
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

  async function save() {
    if (!title.trim()) return error("Add a title");
    if (amt <= 0) return error("Enter a valid amount");
    if (includedCount === 0) return error("Select at least one participant");
    if (splitError) return error(splitError);

    setBusy(true);
    const payload = {
      title: title.trim(),
      category,
      amount: amt,
      paidById,
      date,
      notes: notes.trim(),
      splitMode: mode,
      thumbnail: thumbnail || "",
      shares: inputs,
    };
    try {
      if (editing) {
        await api.updateExpense(group.id, editing.id, payload);
        success("Expense updated");
      } else {
        await api.createExpense(group.id, payload);
        success("Expense added");
      }
      onSaved();
      onClose();
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Couldn't save expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? "Edit expense" : "Add expense"}
      footer={
        <div className="flex gap-2">
          {editing && onDelete && (
            <Button
              variant="danger"
              className="!px-4"
              onClick={() => onDelete(editing)}
              title="Delete expense"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button className="flex-1" loading={busy} onClick={save}>
            {editing ? "Save changes" : "Add expense"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="What was it for?">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner at Olive" autoFocus />
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
        </div>

        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setCategory(c.name)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                  category === c.name
                    ? "border-white/50 text-white"
                    : "border-white/10 text-white/60 hover:text-white/90"
                }`}
                style={category === c.name ? { background: `${c.color}33`, borderColor: c.color } : undefined}
              >
                <span>{c.emoji}</span> {c.name}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Paid by">
            <div className="flex flex-wrap gap-2">
              {group.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaidById(m.id)}
                  className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition ${
                    paidById === m.id ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-white/60"
                  }`}
                >
                  <Avatar name={m.name} src={m.avatar} size={24} />
                  {m.id === group.myUserId ? "You" : m.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Date">
            <DatePicker value={date} onChange={setDate} />
          </Field>
        </div>

        {/* Split mode */}
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-white/70">How to split</span>
          <div className="grid grid-cols-4 gap-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 text-xs font-semibold transition ${
                  mode === m.key ? "border-white/50 bg-white/15 text-white" : "border-white/10 text-white/55 hover:text-white/85"
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-white/40">{MODES.find((m) => m.key === mode)?.hint}</p>
        </div>

        {/* Participants */}
        <div className="rounded-2xl border border-white/10 bg-black/20">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-white/40">
            <span>Split between {includedCount}</span>
            {splitEqualHint() && <span className="text-white/60">{splitEqualHint()}</span>}
          </div>
          <div className="divide-y divide-white/5">
            {group.members.map((m) => {
              const st = shares[m.id] ?? { included: false, value: "" };
              const owed = computed.get(m.id) ?? 0;
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button type="button" onClick={() => toggle(m.id)}>
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-md border transition ${
                        st.included ? "border-orange-400 bg-orange-500/40" : "border-white/20"
                      }`}
                    >
                      {st.included && <span className="text-xs">✓</span>}
                    </div>
                  </button>
                  <Avatar name={m.name} src={m.avatar} size={30} />
                  <span className="flex-1 truncate text-sm text-white/85">
                    {m.id === group.myUserId ? "You" : m.name}
                  </span>

                  {st.included && mode !== "equal" && (
                    <div className="flex items-center gap-1">
                      {mode === "percent" && <span className="text-xs text-white/40">%</span>}
                      <input
                        type="number"
                        inputMode="decimal"
                        value={st.value}
                        onChange={(e) => setValue(m.id, e.target.value)}
                        placeholder={mode === "shares" ? "1" : "0"}
                        className="w-20 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-right text-sm text-white outline-none focus:border-white/40"
                      />
                    </div>
                  )}
                  <span
                    className={`w-20 text-right text-sm font-semibold ${
                      st.included ? "text-white" : "text-white/25"
                    }`}
                  >
                    {st.included ? formatMoney(group.currency, owed) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {splitError && amt > 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {splitError}
          </div>
        )}

        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note…" />
        </Field>

        {/* Receipt */}
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-white/70">Receipt / screenshot</span>
          {thumbnail ? (
            <div className="relative inline-block">
              <button
                type="button"
                onClick={() => setPreview(true)}
                title="Tap to preview"
                className="block cursor-zoom-in overflow-hidden rounded-2xl"
              >
                <img src={thumbnail} alt="receipt" className="h-28 rounded-2xl object-cover" />
              </button>
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
              <ImagePlus className="h-5 w-5" /> Attach a receipt
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        </div>
      </div>
      {preview && <ImageLightbox src={thumbnail} alt="Receipt" onClose={() => setPreview(false)} />}
    </Modal>
  );
}
