import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { formatMoney } from "@shared/currency";
import { initials } from "@/lib/utils";
import type { Balance, Debt } from "@shared/types";

// Internal coordinate space — the SVG scales to its container via viewBox.
const W = 620;
const H = 360;

type FlowNode = SimulationNodeDatum & {
  id: string;
  name: string;
  net: number;
  r: number;
};
type FlowLink = SimulationLinkDatum<FlowNode> & { amount: number };

const CREDITOR = "#38d9a9"; // net > 0 — they're owed money
const DEBTOR = "#ff6b6b"; // net < 0 — they owe money
const NEUTRAL = "#9aa0ad";

function colorForNet(net: number) {
  if (net > 0.01) return CREDITOR;
  if (net < -0.01) return DEBTOR;
  return NEUTRAL;
}

// A force-directed "who pays whom" map. Nodes settle live via a d3 simulation,
// and animated particles flow from each debtor → creditor to show the money
// moving. This visualises the netted settle-up graph, not raw expenses.
export function MoneyFlow({
  balances,
  debts,
  currency,
}: {
  balances: Balance[];
  debts: Debt[];
  currency: string;
}) {
  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ).current;

  const maxAmount = useMemo(
    () => Math.max(1, ...debts.map((d) => d.amount)),
    [debts]
  );

  // Build nodes (union of debt endpoints) and links from the netted debts.
  const { nodes, links } = useMemo(() => {
    const netById = new Map(balances.map((b) => [b.id, b.net]));
    const nameById = new Map(balances.map((b) => [b.id, b.name]));
    const ids = new Set<string>();
    for (const d of debts) {
      ids.add(d.fromId);
      ids.add(d.toId);
      if (!nameById.has(d.fromId)) nameById.set(d.fromId, d.fromName);
      if (!nameById.has(d.toId)) nameById.set(d.toId, d.toName);
    }
    const maxNet = Math.max(1, ...[...ids].map((id) => Math.abs(netById.get(id) ?? 0)));
    const nodes: FlowNode[] = [...ids].map((id) => {
      const net = netById.get(id) ?? 0;
      return {
        id,
        name: nameById.get(id) ?? "?",
        net,
        r: 18 + 16 * Math.sqrt(Math.abs(net) / maxNet),
      };
    });
    const links: FlowLink[] = debts.map((d) => ({
      source: d.fromId,
      target: d.toId,
      amount: d.amount,
    }));
    return { nodes, links };
  }, [balances, debts]);

  // Positions are driven by the simulation's tick callback.
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const simRef = useRef<Simulation<FlowNode, FlowLink> | null>(null);

  useEffect(() => {
    if (nodes.length === 0) return;
    const sim = forceSimulation<FlowNode>(nodes)
      .force("charge", forceManyBody().strength(-520))
      .force(
        "link",
        forceLink<FlowNode, FlowLink>(links)
          .id((n) => n.id)
          .distance((l) => 150 - 70 * (l.amount / maxAmount))
          .strength(0.35)
      )
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<FlowNode>().radius((n) => n.r + 14))
      .on("tick", () => {
        setPositions(
          Object.fromEntries(nodes.map((n) => [n.id, { x: n.x ?? W / 2, y: n.y ?? H / 2 }]))
        );
      });
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [nodes, links, maxAmount]);

  // Particle phase (0..1) drives the flowing dots along each edge.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      setPhase(((now - start) / 1600) % 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  if (debts.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-1 text-center">
        <span className="text-2xl">🎉</span>
        <span className="text-sm text-white/60">Everyone's settled up — no money owed.</span>
      </div>
    );
  }

  const ready = Object.keys(positions).length === nodes.length;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "min(52vh, 360px)" }}
        role="img"
        aria-label="Money flow between members"
      >
        <defs>
          <linearGradient id="mf-edge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff8a3d" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#ffc23d" stopOpacity={0.55} />
          </linearGradient>
        </defs>

        {ready && (
          <>
            {/* Edges + flowing particles (debtor → creditor). */}
            {links.map((l, i) => {
              const s = l.source as FlowNode;
              const t = l.target as FlowNode;
              const sp = positions[s.id];
              const tp = positions[t.id];
              if (!sp || !tp) return null;
              const width = 1.5 + 5 * (l.amount / maxAmount);
              // Two staggered particles per edge for a steady stream.
              const particles = reduceMotion ? [] : [phase, (phase + 0.5) % 1];
              return (
                <g key={`${s.id}-${t.id}-${i}`}>
                  <line
                    x1={sp.x}
                    y1={sp.y}
                    x2={tp.x}
                    y2={tp.y}
                    stroke="url(#mf-edge)"
                    strokeWidth={width}
                    strokeLinecap="round"
                  />
                  {particles.map((p, j) => (
                    <circle
                      key={j}
                      cx={sp.x + (tp.x - sp.x) * p}
                      cy={sp.y + (tp.y - sp.y) * p}
                      r={width * 0.9 + 1.5}
                      fill="#ffd76b"
                      opacity={0.9}
                    />
                  ))}
                  {/* Amount label at the midpoint. */}
                  <text
                    x={(sp.x + tp.x) / 2}
                    y={(sp.y + tp.y) / 2 - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill="rgba(255,255,255,0.75)"
                    style={{ paintOrder: "stroke", pointerEvents: "none" }}
                  >
                    {formatMoney(currency, l.amount)}
                  </text>
                </g>
              );
            })}

            {/* Member nodes. */}
            {nodes.map((n) => {
              const p = positions[n.id];
              if (!p) return null;
              const c = colorForNet(n.net);
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                  <circle r={n.r} fill={`${c}26`} stroke={c} strokeWidth={2} />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.max(11, n.r * 0.5)}
                    fontWeight={800}
                    fill="#fff"
                  >
                    {initials(n.name)}
                  </text>
                  <text
                    y={n.r + 15}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill="rgba(255,255,255,0.9)"
                  >
                    {n.name.length > 12 ? `${n.name.slice(0, 11)}…` : n.name}
                  </text>
                  <text
                    y={n.r + 29}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={c}
                  >
                    {n.net > 0.01
                      ? `gets ${formatMoney(currency, n.net)}`
                      : n.net < -0.01
                        ? `owes ${formatMoney(currency, -n.net)}`
                        : "settled"}
                  </text>
                </g>
              );
            })}
          </>
        )}
      </svg>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: CREDITOR }} /> is owed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: DEBTOR }} /> owes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-6 rounded-full" style={{ background: "#ffd76b" }} /> money flows toward who's owed
        </span>
      </div>
    </div>
  );
}
