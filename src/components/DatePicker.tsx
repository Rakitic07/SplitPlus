import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Warm gradient reused for the selected day/month pill.
const SELECTED_BG = "linear-gradient(135deg, #ff8a3d, #ffab33 55%, #ffc23d)";

// Parse a YYYY-MM-DD string into a *local* date (no timezone shift).
function parse(value: string): Date {
  const [y, m, d] = (value || "").split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function toValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// A theme-matched date picker (replaces the OS-native calendar) so the popover
// is glassy and on-brand, like Spendly-Plus.
export function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = useMemo(() => parse(value), [value]);
  const today = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "month">("day");
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewYear(selected.getFullYear());
    setViewMonth(selected.getMonth());
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A stable 6-row (42-cell) grid, Sunday-first.
  const cells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [viewYear, viewMonth]);

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  function pick(d: Date) {
    onChange(toValue(d));
    setOpen(false);
    setMode("day");
  }

  function openPopover() {
    setMode("day");
    setViewYear(selected.getFullYear());
    setViewMonth(selected.getMonth());
    setOpen((o) => !o);
  }

  const label = `${WEEKDAYS_FULL(selected)} ${selected.getDate()} ${MONTH_SHORT[selected.getMonth()]} ${selected.getFullYear()}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={openPopover}
        className="glass-input flex items-center justify-between text-left"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{label}</span>
        <Calendar className="h-4 w-4 text-white/50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="glass-strong absolute left-0 z-40 mt-2 w-[268px] max-w-[86vw] rounded-2xl p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => (mode === "day" ? shiftMonth(-1) : setViewYear((y) => y - 1))}
                className="grid h-7 w-7 place-items-center rounded-lg text-white/70 transition hover:bg-white/15 hover:text-white"
                aria-label={mode === "day" ? "Previous month" : "Previous year"}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setMode((m) => (m === "day" ? "month" : "day"))}
                className="rounded-lg px-2 py-0.5 text-[13px] font-semibold transition hover:bg-white/10"
              >
                {mode === "day" ? `${MONTH_LABELS[viewMonth]} ${viewYear}` : viewYear}
              </button>
              <button
                type="button"
                onClick={() => (mode === "day" ? shiftMonth(1) : setViewYear((y) => y + 1))}
                className="grid h-7 w-7 place-items-center rounded-lg text-white/70 transition hover:bg-white/15 hover:text-white"
                aria-label={mode === "day" ? "Next month" : "Next year"}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {mode === "month" ? (
              <div className="grid grid-cols-3 gap-1.5">
                {MONTH_LABELS.map((m, i) => {
                  const isCur = i === viewMonth;
                  const isSelMonth =
                    i === selected.getMonth() && viewYear === selected.getFullYear();
                  return (
                    <button
                      type="button"
                      key={m}
                      onClick={() => {
                        setViewMonth(i);
                        setMode("day");
                      }}
                      className={cn(
                        "rounded-xl py-2 text-[13px] font-medium transition",
                        isSelMonth ? "text-white" : "text-white/75 hover:bg-white/15"
                      )}
                      style={
                        isSelMonth
                          ? { backgroundImage: SELECTED_BG, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }
                          : isCur
                            ? { background: "rgba(255,255,255,0.12)" }
                            : undefined
                      }
                    >
                      {MONTH_SHORT[i]}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-medium text-white/45">
                  {WEEKDAYS.map((w, i) => (
                    <div key={i} className="py-1">
                      {w}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {cells.map((d, i) => {
                    const inMonth = d.getMonth() === viewMonth;
                    const isSelected = sameDay(d, selected);
                    const isToday = sameDay(d, today);
                    return (
                      <button
                        type="button"
                        key={i}
                        onClick={() => pick(d)}
                        className={cn(
                          "relative grid h-8 w-full place-items-center rounded-lg text-[13px] transition",
                          inMonth ? "text-white/90" : "text-white/25",
                          !isSelected && "hover:bg-white/15"
                        )}
                        style={
                          isSelected
                            ? {
                                backgroundImage: SELECTED_BG,
                                boxShadow:
                                  "0 6px 14px -8px rgba(255,138,61,0.8), inset 0 1px 0 rgba(255,255,255,0.5)",
                              }
                            : undefined
                        }
                      >
                        {d.getDate()}
                        {isToday && !isSelected && (
                          <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#ffab33]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={() =>
                  pick(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
                }
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-white/70 transition hover:bg-white/10"
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => pick(new Date())}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[#ffab33] transition hover:bg-white/10"
              >
                Today
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function WEEKDAYS_FULL(d: Date): string {
  return WEEKDAY_SHORT[d.getDay()];
}
