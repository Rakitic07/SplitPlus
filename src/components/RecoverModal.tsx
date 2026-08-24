import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  KeyRound,
  LifeBuoy,
  ScanSearch,
  ShieldCheck,
  ShieldQuestion,
  UserSearch,
} from "lucide-react";
import { Modal } from "./Modal";
import { Button, Field, Input, PasswordInput } from "./ui";
import {
  api,
  ApiError,
  type ResetAnswers,
  type ResetQuestionnaire,
  type ResetStatus,
} from "@/lib/api";
import { useAuth } from "@/state/auth";
import { useToast } from "@/state/toast";
import type { SelfUser } from "@shared/types";

type Step = "choose" | "code" | "verify" | "find" | "request" | "requested" | "status" | "done";

export function RecoverModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { recover, resetVerify, finishAuth } = useAuth();
  const { success, error } = useToast();

  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [answers, setAnswers] = useState<ResetAnswers>({});

  // Admin-approved reset: questionnaire + the ticket to check status later.
  const [questionnaire, setQuestionnaire] = useState<ResetQuestionnaire>({});
  const [ticket, setTicket] = useState("");
  const [statusInput, setStatusInput] = useState("");
  const [statusResult, setStatusResult] = useState<ResetStatus | null>(null);

  // "Find my name" helper.
  const [findQuery, setFindQuery] = useState("");
  const [matches, setMatches] = useState<string[] | null>(null);

  // The freshly-issued recovery code + the authed user, shown on the done step.
  const [newCode, setNewCode] = useState("");
  const [pendingUser, setPendingUser] = useState<SelfUser | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset everything whenever the modal is (re)opened.
  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setBusy(false);
    setName("");
    setPassphrase("");
    setCode("");
    setAnswers({});
    setFindQuery("");
    setMatches(null);
    setNewCode("");
    setPendingUser(null);
    setCopied(false);
    setQuestionnaire({});
    setTicket("");
    setStatusInput("");
    setStatusResult(null);
  }, [open]);

  function back() {
    setStep("choose");
    setMatches(null);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { user, recoveryCode } = await recover(name.trim(), code.trim(), passphrase);
      setPendingUser(user);
      setNewCode(recoveryCode);
      setStep("done");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { user, recoveryCode } = await resetVerify(name.trim(), passphrase, answers);
      setPendingUser(user);
      setNewCode(recoveryCode);
      setStep("done");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { ticket } = await api.requestReset(name.trim(), passphrase, questionnaire);
      setTicket(ticket);
      setStep("requested");
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitStatus(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatusResult(null);
    try {
      const { status } = await api.resetStatus(name.trim(), statusInput.trim());
      setStatusResult(status);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitFind(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMatches(null);
    try {
      const { matches } = await api.findAccount(findQuery.trim());
      setMatches(matches);
    } catch (err) {
      error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const title =
    step === "done"
      ? "Passphrase reset"
      : step === "code"
        ? "Reset with your code"
        : step === "verify"
          ? "Verify it's you"
          : step === "find"
            ? "Find your name"
            : step === "request"
              ? "Request an admin reset"
              : step === "requested"
                ? "Request submitted"
                : step === "status"
                  ? "Check request status"
                  : "Recover access";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {step === "choose" && (
        <div className="space-y-2.5">
          <p className="mb-1 text-sm text-white/55">Forgot your passphrase? Pick how to recover.</p>
          <ChoiceButton
            icon={<KeyRound className="h-5 w-5 text-emerald-400" />}
            title="I have my recovery code"
            subtitle="Reset instantly — the code shown once at sign-up."
            onClick={() => setStep("code")}
          />
          <ChoiceButton
            icon={<ShieldQuestion className="h-5 w-5 text-amber-300" />}
            title="Verify with account details"
            subtitle="Lost the code too? Answer a few private details instead."
            onClick={() => setStep("verify")}
          />
          <ChoiceButton
            icon={<LifeBuoy className="h-5 w-5 text-orange-300" />}
            title="Ask an admin to reset it"
            subtitle="No code and can't verify? Submit a request for admin approval."
            onClick={() => setStep("request")}
          />
          <div className="flex items-center justify-center gap-4 pt-1 text-center">
            <button
              type="button"
              onClick={() => setStep("status")}
              className="inline-flex items-center gap-1.5 text-xs text-white/55 underline-offset-2 transition hover:text-white/85 hover:underline"
            >
              <Clock className="h-3.5 w-3.5" /> Check a request
            </button>
            <button
              type="button"
              onClick={() => setStep("find")}
              className="inline-flex items-center gap-1.5 text-xs text-white/55 underline-offset-2 transition hover:text-white/85 hover:underline"
            >
              <UserSearch className="h-3.5 w-3.5" /> Forgot your name too?
            </button>
          </div>
        </div>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} className="space-y-4">
          <BackBtn onClick={back} />
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raktim" required />
          </Field>
          <Field label="Recovery code" hint="The code shown once when you signed up.">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="font-mono tracking-wider"
              required
            />
          </Field>
          <Field label="New passphrase" hint="At least 6 characters.">
            <PasswordInput
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            <KeyRound className="h-4 w-4" /> Reset passphrase
          </Button>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={submitVerify} className="space-y-4">
          <BackBtn onClick={back} />
          <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
            Fill in what you remember — we check these against your real groups &amp; expenses. Get at
            least two right to reset.
          </p>
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raktim" required />
          </Field>
          <Field label="New passphrase" hint="At least 6 characters.">
            <PasswordInput
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="A group you're in">
              <Input
                value={answers.groupName ?? ""}
                onChange={(e) => setAnswers({ ...answers, groupName: e.target.value })}
                placeholder="e.g. Goa Trip"
              />
            </Field>
            <Field label="A recent expense">
              <Input
                value={answers.expenseTitle ?? ""}
                onChange={(e) => setAnswers({ ...answers, expenseTitle: e.target.value })}
                placeholder="e.g. Dinner"
              />
            </Field>
            <Field label="A recent amount">
              <Input
                value={answers.amount ?? ""}
                onChange={(e) => setAnswers({ ...answers, amount: e.target.value })}
                placeholder="e.g. 1200"
                inputMode="decimal"
              />
            </Field>
            <Field label="Someone in your group">
              <Input
                value={answers.memberName ?? ""}
                onChange={(e) => setAnswers({ ...answers, memberName: e.target.value })}
                placeholder="e.g. Priya"
              />
            </Field>
          </div>
          <Button type="submit" loading={busy} className="w-full">
            <ScanSearch className="h-4 w-4" /> Verify &amp; reset
          </Button>
        </form>
      )}

      {step === "find" && (
        <form onSubmit={submitFind} className="space-y-4">
          <BackBtn onClick={back} />
          <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
            Type the first few characters of your name (at least 3).
          </p>
          <Field label="First characters of your name">
            <Input
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="e.g. rak"
              required
            />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            <UserSearch className="h-4 w-4" /> Search
          </Button>
          {matches && (
            <div className="space-y-1.5 pt-1">
              {matches.length === 0 ? (
                <p className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/60">
                  No matching name found. Try different characters.
                </p>
              ) : (
                <>
                  <p className="text-[11px] uppercase tracking-wide text-white/40">Matches — tap to use</p>
                  {matches.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setName(m);
                        setStep("choose");
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm transition hover:bg-white/10"
                    >
                      <span className="truncate font-medium text-white/90">{m}</span>
                      <ArrowLeft className="h-3.5 w-3.5 shrink-0 rotate-180 text-white/40" />
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </form>
      )}

      {step === "request" && (
        <form onSubmit={submitRequest} className="space-y-4">
          <BackBtn onClick={back} />
          <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
            Choose a new passphrase and tell us what you remember. An admin verifies the details and
            approves — then log in with the new passphrase.
          </p>
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raktim" required />
          </Field>
          <Field label="New passphrase" hint="Applied only after an admin approves.">
            <PasswordInput
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="A group you're in">
              <Input
                value={questionnaire.groupName ?? ""}
                onChange={(e) => setQuestionnaire({ ...questionnaire, groupName: e.target.value })}
                placeholder="e.g. Goa Trip"
              />
            </Field>
            <Field label="A recent expense">
              <Input
                value={questionnaire.expenseTitle ?? ""}
                onChange={(e) => setQuestionnaire({ ...questionnaire, expenseTitle: e.target.value })}
                placeholder="e.g. Dinner"
              />
            </Field>
            <Field label="A recent amount">
              <Input
                value={questionnaire.amount ?? ""}
                onChange={(e) => setQuestionnaire({ ...questionnaire, amount: e.target.value })}
                placeholder="e.g. 1200"
                inputMode="decimal"
              />
            </Field>
            <Field label="Someone in your group">
              <Input
                value={questionnaire.memberName ?? ""}
                onChange={(e) => setQuestionnaire({ ...questionnaire, memberName: e.target.value })}
                placeholder="e.g. Priya"
              />
            </Field>
          </div>
          <Field label="Anything else (optional)" hint="Extra context to help the admin verify you.">
            <Input
              value={questionnaire.note ?? ""}
              onChange={(e) => setQuestionnaire({ ...questionnaire, note: e.target.value })}
              placeholder="e.g. I'm the owner of the Goa Trip group"
            />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            <LifeBuoy className="h-4 w-4" /> Submit request
          </Button>
        </form>
      )}

      {step === "requested" && (
        <div className="space-y-4 text-center">
          <Clock className="mx-auto h-10 w-10 text-orange-300" />
          <div>
            <h3 className="text-lg font-bold text-white">Request submitted</h3>
            <p className="mt-1 text-sm text-white/60">
              An admin will review it shortly. Save this ticket to check the status later.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black/30 px-4 py-3">
            <code className="select-all font-mono text-base font-bold tracking-widest text-white">
              {ticket}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(ticket).then(() => {
                  setCopied(true);
                  success("Copied");
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="rounded-xl p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Copy ticket"
            >
              {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
            </button>
          </div>
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      )}

      {step === "status" && (
        <form onSubmit={submitStatus} className="space-y-4">
          <BackBtn onClick={back} />
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raktim" required />
          </Field>
          <Field label="Ticket" hint="The code you got when you submitted the request.">
            <Input
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              className="font-mono tracking-wider"
              required
            />
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            <Clock className="h-4 w-4" /> Check status
          </Button>
          {statusResult && (
            <div
              className={`rounded-xl border px-3 py-3 text-sm ${
                statusResult === "approved"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                  : statusResult === "rejected"
                    ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-200"
              }`}
            >
              {statusResult === "approved" ? (
                <>Approved! Close this and log in with the new passphrase you chose.</>
              ) : statusResult === "rejected" ? (
                <>This request was rejected. You can submit a new one with more accurate details.</>
              ) : (
                <>Still pending — an admin hasn't reviewed it yet. Check back soon.</>
              )}
            </div>
          )}
        </form>
      )}

      {step === "done" && (
        <div className="space-y-4 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-emerald-400" />
          <div>
            <h3 className="text-lg font-bold text-white">You're back in</h3>
            <p className="mt-1 text-sm text-white/60">
              Save your new recovery code — it's shown once and replaces the old one.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-black/30 px-4 py-3">
            <code className="select-all font-mono text-base font-bold tracking-widest text-white">
              {newCode}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(newCode).then(() => {
                  setCopied(true);
                  success("Copied");
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="rounded-xl p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Copy recovery code"
            >
              {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
            </button>
          </div>
          <Button
            className="w-full"
            onClick={() => {
              if (pendingUser) finishAuth(pendingUser);
              onClose();
            }}
          >
            I've saved it — continue
          </Button>
        </div>
      )}
    </Modal>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs text-white/50 transition hover:text-white/80"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back
    </button>
  );
}

function ChoiceButton({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
    >
      {icon}
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="block text-xs text-white/50">{subtitle}</span>
      </span>
    </button>
  );
}
