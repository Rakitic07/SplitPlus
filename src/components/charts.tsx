import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { categoryMeta } from "@shared/categories";
import { formatMoney } from "@shared/currency";
import { colorForName } from "@/lib/utils";
import type { Balance, Expense } from "@shared/types";

const AXIS = { fontSize: 11, fill: "rgba(255,255,255,0.5)" };

function money(currency: string) {
  return (v: number) => formatMoney(currency, v);
}

// Spending by category — donut.
export function CategoryDonut({
  expenses,
  currency,
}: {
  expenses: Expense[];
  currency: string;
}) {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  const data = [...map.entries()]
    .map(([name, value]) => ({ name, value, color: categoryMeta(name).color }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) return <NoData />;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <ResponsiveContainer width="100%" height={200} className="!w-full sm:!w-1/2">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={54}
            outerRadius={82}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => money(currency)(v)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="w-full space-y-1.5 sm:w-1/2">
        {data.slice(0, 6).map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-full" style={{ background: d.color }} />
            <span className="flex-1 truncate text-white/70">
              {categoryMeta(d.name).emoji} {d.name}
            </span>
            <span className="font-semibold text-white">{money(currency)(d.value)}</span>
            <span className="w-10 text-right text-xs text-white/40">
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Net balance per member — diverging bars (green owed, rose owes).
export function BalanceBars({
  balances,
  currency,
}: {
  balances: Balance[];
  currency: string;
}) {
  const data = balances
    .filter((b) => Math.abs(b.net) > 0.01)
    .map((b) => ({ name: b.name, net: Number(b.net.toFixed(2)) }))
    .sort((a, b) => b.net - a.net);
  if (data.length === 0) return <NoData label="Everyone's settled up 🎉" />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
        <XAxis type="number" tick={AXIS} tickFormatter={(v) => money(currency)(v)} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={70} />
        <Tooltip formatter={(v: number) => money(currency)(v)} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
        <Bar dataKey="net" radius={[6, 6, 6, 6]}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.net >= 0 ? "#38d9a9" : "#ff6b6b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Who paid how much — bars per payer.
export function PaidByBars({
  expenses,
  currency,
}: {
  expenses: Expense[];
  currency: string;
}) {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.paidBy.name, (map.get(e.paidBy.name) ?? 0) + e.amount);
  const data = [...map.entries()]
    .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);
  if (data.length === 0) return <NoData />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
        <XAxis type="number" tick={AXIS} tickFormatter={(v) => money(currency)(v)} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={70} />
        <Tooltip formatter={(v: number) => money(currency)(v)} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
        <Bar dataKey="value" radius={[6, 6, 6, 6]}>
          {data.map((d) => (
            <Cell key={d.name} fill={colorForName(d.name)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Spending over time — area by day.
export function TrendArea({
  expenses,
  currency,
}: {
  expenses: Expense[];
  currency: string;
}) {
  const map = new Map<string, number>();
  for (const e of expenses) {
    const key = e.date.slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + e.amount);
  }
  const data = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({
      date: new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      value: Number(value.toFixed(2)),
    }));
  if (data.length === 0) return <NoData />;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff8a3d" stopOpacity={0.6} />
            <stop offset="100%" stopColor="#ff8a3d" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={AXIS} />
        <YAxis tick={AXIS} tickFormatter={(v) => money(currency)(v)} width={54} />
        <Tooltip formatter={(v: number) => money(currency)(v)} />
        <Area type="monotone" dataKey="value" stroke="#ffab33" strokeWidth={2} fill="url(#trend)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function NoData({ label = "No data yet" }: { label?: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-white/40">{label}</div>
  );
}
