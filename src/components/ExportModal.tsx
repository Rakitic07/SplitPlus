import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";
import { api, type ExportExpense } from "@/lib/api";
import type { Expense, GroupDetail } from "@shared/types";
import { formatMoney } from "@shared/currency";
import { useToast } from "@/state/toast";
import {
  buildReportHtml,
  downloadXlsx,
  printDocument,
  type XlsxSheet,
} from "@/lib/export";

// One normalised expense row that both the per-group and overall exports share.
type Row = {
  date: string;
  title: string;
  category: string;
  amount: number;
  paidBy: string;
  splitMode: string;
  myShare: number;
  notes: string;
  groupName: string;
  currency: string;
};

type PeriodMode = "all" | "year" | "month";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export";
}

export function ExportModal({
  open,
  onClose,
  scope,
  group,
  expenses,
}: {
  open: boolean;
  onClose: () => void;
  scope: "group" | "overall";
  group?: GroupDetail | null;
  expenses?: Expense[];
}) {
  const { error, success } = useToast();
  const [mode, setMode] = useState<PeriodMode>("all");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth());
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);

  // Overall scope pulls every expense across the user's groups on open.
  const [overall, setOverall] = useState<ExportExpense[] | null>(null);
  const [loadingOverall, setLoadingOverall] = useState(false);

  useEffect(() => {
    if (!open || scope !== "overall") return;
    let alive = true;
    setLoadingOverall(true);
    api
      .exportExpenses()
      .then((r) => alive && setOverall(r.expenses))
      .catch(() => alive && error("Couldn't load your expenses"))
      .finally(() => alive && setLoadingOverall(false));
    return () => {
      alive = false;
    };
  }, [open, scope, error]);

  // Normalise the source rows into a single shape.
  const rows = useMemo<Row[]>(() => {
    if (scope === "group") {
      const cur = group?.currency ?? "INR";
      const myId = group?.myUserId ?? "";
      const name = group?.name ?? "Group";
      return (expenses ?? []).map((e) => ({
        date: e.date,
        title: e.title,
        category: e.category,
        amount: e.amount,
        paidBy: e.paidBy.name,
        splitMode: e.splitMode,
        myShare: e.shares.find((s) => s.userId === myId)?.amount ?? 0,
        notes: e.notes ?? "",
        groupName: name,
        currency: cur,
      }));
    }
    return (overall ?? []).map((e) => ({
      date: e.date,
      title: e.title,
      category: e.category,
      amount: e.amount,
      paidBy: e.paidBy.name,
      splitMode: e.splitMode,
      myShare: e.myShare,
      notes: e.notes ?? "",
      groupName: e.group.name,
      currency: e.group.currency,
    }));
  }, [scope, group, expenses, overall]);

  // Years present in the data (for the year/month pickers).
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) {
      const d = new Date(r.date);
      if (!Number.isNaN(d.getTime())) set.add(d.getFullYear());
    }
    const arr = Array.from(set).sort((a, b) => b - a);
    return arr.length ? arr : [new Date().getFullYear()];
  }, [rows]);

  // Keep the selected year valid once data arrives.
  useEffect(() => {
    if (!years.includes(year)) setYear(years[0]);
  }, [years, year]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (mode === "all") return true;
      const d = new Date(r.date);
      if (Number.isNaN(d.getTime())) return false;
      if (d.getFullYear() !== year) return false;
      if (mode === "month" && d.getMonth() !== month) return false;
      return true;
    });
  }, [rows, mode, year, month]);

  const periodLabel =
    mode === "all" ? "All time" : mode === "year" ? `${year}` : `${MONTHS[month]} ${year}`;

  const scopeLabel = scope === "group" ? group?.name ?? "Group" : "All groups";

  const baseName = `split-plus-${slug(scopeLabel)}-${
    mode === "all" ? "all-time" : mode === "year" ? year : `${year}-${String(month + 1).padStart(2, "0")}`
  }`;

  // Totals broken down by currency (an overall export can mix currencies).
  const totalsByCurrency = useMemo(() => {
    const m = new Map<string, { spent: number; myShare: number; count: number }>();
    for (const r of filtered) {
      const t = m.get(r.currency) ?? { spent: 0, myShare: 0, count: 0 };
      t.spent += r.amount;
      t.myShare += r.myShare;
      t.count += 1;
      m.set(r.currency, t);
    }
    return m;
  }, [filtered]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) m.set(r.category, (m.get(r.category) ?? 0) + r.amount);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  function guard(): boolean {
    if (filtered.length === 0) {
      error("No expenses in this period to export.");
      return false;
    }
    return true;
  }

  function handleXlsx() {
    if (!guard()) return;
    setBusy("xlsx");
    try {
      const header =
        scope === "overall"
          ? ["Date", "Group", "Title", "Category", "Paid by", "Split", "Amount", "Currency", "Your share", "Notes"]
          : ["Date", "Title", "Category", "Paid by", "Split", "Amount", "Your share", "Notes"];

      const dataRows = filtered.map((r) =>
        scope === "overall"
          ? [fmtDate(r.date), r.groupName, r.title, r.category, r.paidBy, r.splitMode, r.amount, r.currency, r.myShare, r.notes]
          : [fmtDate(r.date), r.title, r.category, r.paidBy, r.splitMode, r.amount, r.myShare, r.notes]
      );

      const summaryRows: (string | number)[][] = [];
      for (const [cur, t] of totalsByCurrency) {
        summaryRows.push([`Total spent (${cur})`, t.spent]);
        summaryRows.push([`Your share (${cur})`, t.myShare]);
      }
      summaryRows.push(["Expenses", filtered.length]);
      summaryRows.push(["Period", periodLabel]);
      summaryRows.push([]);
      summaryRows.push(["By category", "Amount"]);
      for (const [cat, amt] of byCategory) summaryRows.push([cat, amt]);

      const sheets: XlsxSheet[] = [
        { name: "Summary", header: ["Metric", "Value"], rows: summaryRows },
        { name: "Expenses", header, rows: dataRows },
      ];
      downloadXlsx(sheets, baseName);
      success("Excel file downloaded");
      onClose();
    } catch {
      error("Couldn't generate the Excel file.");
    } finally {
      setBusy(null);
    }
  }

  function handlePdf() {
    if (!guard()) return;
    setBusy("pdf");
    try {
      const summary: { label: string; value: string }[] = [];
      for (const [cur, t] of totalsByCurrency) {
        summary.push({ label: `Total (${cur})`, value: formatMoney(cur, t.spent) });
        summary.push({ label: `Your share (${cur})`, value: formatMoney(cur, t.myShare) });
      }
      summary.push({ label: "Expenses", value: String(filtered.length) });

      const columns =
        scope === "overall"
          ? ["Date", "Group", "Title", "Category", "Paid by", "Amount", "Your share"]
          : ["Date", "Title", "Category", "Paid by", "Amount", "Your share"];

      const tableRows = filtered.map((r) =>
        scope === "overall"
          ? [fmtDate(r.date), r.groupName, r.title, r.category, r.paidBy, formatMoney(r.currency, r.amount), formatMoney(r.currency, r.myShare)]
          : [fmtDate(r.date), r.title, r.category, r.paidBy, formatMoney(r.currency, r.amount), formatMoney(r.currency, r.myShare)]
      );

      const html = buildReportHtml({
        title: scope === "group" ? `${group?.name ?? "Group"} — Expenses` : "All groups — Expenses",
        subtitle: `${periodLabel} · ${filtered.length} expense${filtered.length === 1 ? "" : "s"}`,
        summary,
        tables: [{ heading: "Expenses", table: { columns, rows: tableRows } }],
      });
      printDocument(html);
      onClose();
    } catch {
      error("Couldn't generate the PDF.");
    } finally {
      setBusy(null);
    }
  }

  const loading = scope === "overall" && loadingOverall;
  const disabled = busy !== null || loading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={scope === "group" ? "Export this group" : "Export all expenses"}
    >
      <div className="space-y-5">
        <p className="text-sm text-white/60">
          Download {scope === "group" ? "this group's" : "your"} expenses as a spreadsheet or a
          print-ready PDF. Pick a period below.
        </p>

        {/* Period mode */}
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1">
          {(["all", "year", "month"] as PeriodMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-xl py-2 text-sm font-semibold capitalize transition ${
                mode === m ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {m === "all" ? "All time" : m}
            </button>
          ))}
        </div>

        {mode !== "all" && (
          <div className="flex gap-3">
            {mode === "month" && (
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="glass-input flex-1"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i} className="bg-stone-900">
                    {m}
                  </option>
                ))}
              </select>
            )}
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="glass-input flex-1"
            >
              {years.map((y) => (
                <option key={y} value={y} className="bg-stone-900">
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Preview line */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
          {loading ? (
            <span className="flex items-center gap-2 text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your expenses…
            </span>
          ) : (
            <span className="text-white/70">
              <b className="text-white">{filtered.length}</b> expense
              {filtered.length === 1 ? "" : "s"} · {scopeLabel} · {periodLabel}
            </span>
          )}
        </div>

        {/* Format actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={handleXlsx} disabled={disabled} loading={busy === "xlsx"}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="ghost" onClick={handlePdf} disabled={disabled} loading={busy === "pdf"}>
            <FileText className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}
