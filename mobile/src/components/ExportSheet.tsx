import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./ui";
import { api, ApiError, type ExportExpense } from "../lib/api";
import { formatMoney } from "../shared/currency";
import { useToast } from "../state/toast";
import { theme } from "../theme";
import type { Expense, GroupDetail } from "../shared/types";
import { buildReportHtml, shareCsv, sharePdf, toCsv } from "../lib/export";

type Period = "all" | "month" | "year";

type Row = {
  date: string;
  title: string;
  category: string;
  amount: number;
  paidBy: string;
  myShare: number;
  notes: string;
  groupName: string;
  currency: string;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export";
}

export function ExportSheet({
  visible,
  onClose,
  scope,
  group,
  expenses,
  myId,
}: {
  visible: boolean;
  onClose: () => void;
  scope: "group" | "overall";
  group?: GroupDetail | null;
  expenses?: Expense[];
  myId?: string;
}) {
  const insets = useSafeAreaInsets();
  const { success, error } = useToast();
  const [period, setPeriod] = useState<Period>("all");
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [overall, setOverall] = useState<ExportExpense[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || scope !== "overall") return;
    let alive = true;
    setLoading(true);
    api
      .exportExpenses()
      .then((r) => alive && setOverall(r.expenses))
      .catch((e) => alive && error(e instanceof ApiError ? e.message : "Couldn't load expenses"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visible, scope, error]);

  const rows = useMemo<Row[]>(() => {
    if (scope === "group") {
      const cur = group?.currency ?? "INR";
      const me = myId ?? group?.myUserId ?? "";
      const name = group?.name ?? "Group";
      return (expenses ?? []).map((e) => ({
        date: e.date,
        title: e.title,
        category: e.category,
        amount: e.amount,
        paidBy: e.paidBy.name,
        myShare: e.shares.find((s) => s.userId === me)?.amount ?? 0,
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
      myShare: e.myShare,
      notes: e.notes ?? "",
      groupName: e.group.name,
      currency: e.group.currency,
    }));
  }, [scope, group, expenses, overall, myId]);

  const now = new Date();
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (period === "all") return true;
      const d = new Date(r.date);
      if (Number.isNaN(d.getTime())) return false;
      if (d.getFullYear() !== now.getFullYear()) return false;
      if (period === "month" && d.getMonth() !== now.getMonth()) return false;
      return true;
    });
  }, [rows, period, now]);

  const periodLabel =
    period === "all"
      ? "All time"
      : period === "year"
      ? `${now.getFullYear()}`
      : now.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const scopeLabel = scope === "group" ? group?.name ?? "Group" : "All groups";
  const baseName = `split-plus-${slug(scopeLabel)}-${period}`;

  const totalsByCurrency = useMemo(() => {
    const m = new Map<string, { spent: number; myShare: number }>();
    for (const r of filtered) {
      const t = m.get(r.currency) ?? { spent: 0, myShare: 0 };
      t.spent += r.amount;
      t.myShare += r.myShare;
      m.set(r.currency, t);
    }
    return m;
  }, [filtered]);

  function guard(): boolean {
    if (filtered.length === 0) {
      error("No expenses in this period to export.");
      return false;
    }
    return true;
  }

  async function doCsv() {
    if (!guard()) return;
    setBusy("csv");
    try {
      const header =
        scope === "overall"
          ? ["Date", "Group", "Title", "Category", "Paid by", "Amount", "Currency", "Your share", "Notes"]
          : ["Date", "Title", "Category", "Paid by", "Amount", "Your share", "Notes"];
      const data = filtered.map((r) =>
        scope === "overall"
          ? [fmtDate(r.date), r.groupName, r.title, r.category, r.paidBy, r.amount, r.currency, r.myShare, r.notes]
          : [fmtDate(r.date), r.title, r.category, r.paidBy, r.amount, r.myShare, r.notes]
      );
      await shareCsv(toCsv(header, data), `${baseName}.csv`);
      success("Spreadsheet ready to share");
      onClose();
    } catch {
      error("Couldn't create the spreadsheet.");
    } finally {
      setBusy(null);
    }
  }

  async function doPdf() {
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
        table: { columns, rows: tableRows },
      });
      await sharePdf(html);
      success("PDF ready to share");
      onClose();
    } catch {
      error("Couldn't create the PDF.");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || loading;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={styles.title}>
            {scope === "group" ? "Export this group" : "Export all expenses"}
          </Text>
          <Text style={styles.sub}>
            Download {scope === "group" ? "this group's" : "your"} expenses as a PDF or spreadsheet.
          </Text>

          <View style={styles.pills}>
            {(["all", "month", "year"] as Period[]).map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={[styles.pill, period === p && styles.pillActive]}
              >
                <Text style={[styles.pillText, period === p && { color: "#fff" }]}>
                  {p === "all" ? "All time" : p === "month" ? "This month" : "This year"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.preview}>
            {loading ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator color={theme.colors.primary} size="small" />
                <Text style={{ color: theme.colors.textDim }}>Loading your expenses…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.textDim }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>{filtered.length}</Text> expense
                {filtered.length === 1 ? "" : "s"} · {scopeLabel} · {periodLabel}
              </Text>
            )}
          </View>

          <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
            <Button title="Excel / CSV" onPress={doCsv} loading={busy === "csv"} disabled={disabled} style={{ flex: 1 }} />
            <Button title="PDF" variant="ghost" onPress={doPdf} loading={busy === "pdf"} disabled={disabled} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  sub: { color: theme.colors.textFaint, fontSize: 13, marginTop: 6, marginBottom: 16 },
  pills: { flexDirection: "row", gap: 8, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 16, padding: 4 },
  pill: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 12 },
  pillActive: { backgroundColor: "rgba(255,255,255,0.15)" },
  pillText: { color: theme.colors.textFaint, fontWeight: "700", fontSize: 13 },
  preview: { marginTop: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14, paddingVertical: 12 },
});
