import { useId, useMemo, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { Play } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";
import { colorForName, initials } from "@/lib/utils";
import { formatMoney } from "@shared/currency";
import { categoryMeta } from "@shared/categories";
import type { Expense, PublicUser } from "@shared/types";

// Internal coordinate space — the SVG scales to its container via viewBox.
const S = 360;
const C = S / 2;
const COIN = "#ffd76b";
const OWES = "#ff8f8f";

type Bubble = {
  id: string;
  /** Display label ("You" for the signed-in user). */
  name: string;
  /** Real name, for initials and the fallback color. */
  fullName: string;
  avatar?: string | null;
  x: number;
  y: number;
  r: number;
  share: number;
};

type Flow = {
  to: Bubble;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  angle: number;
  start: number;
};

const short = (s: string) => (s.length > 11 ? `${s.slice(0, 10)}…` : s);

// Payer in the middle, everyone whose share they covered on a ring around them.
function layout(expense: Expense, members: PublicUser[], myId: string) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const label = (id: string, name: string) => (id === myId ? "You" : name);
  const payerId = expense.paidBy.id;
  const others = expense.shares.filter((s) => s.userId !== payerId && s.amount > 0.004);
  const n = others.length;
  const r = n <= 4 ? 27 : n <= 8 ? 22 : 17;
  const ring = n <= 6 ? 118 : 128;

  const payer: Bubble = {
    id: payerId,
    name: label(payerId, expense.paidBy.name),
    fullName: expense.paidBy.name,
    avatar: byId.get(payerId)?.avatar ?? expense.paidBy.avatar,
    x: n === 1 ? 92 : C,
    y: C,
    r: 34,
    share: expense.shares.find((s) => s.userId === payerId)?.amount ?? 0,
  };

  const stagger = Math.min(0.45, 2.4 / Math.max(1, n));
  const borrowers: Bubble[] = others.map((s, i) => {
    // Half-step offset from straight down: no one sits directly below the payer,
    // where the payer's own labels are.
    const a = (90 + ((i + 0.5) * 360) / n) * (Math.PI / 180);
    return {
      id: s.userId,
      name: label(s.userId, s.name),
      fullName: s.name,
      avatar: byId.get(s.userId)?.avatar,
      x: n === 1 ? S - 92 : C + ring * Math.cos(a),
      y: n === 1 ? C : C + ring * Math.sin(a),
      r,
      share: s.amount,
    };
  });

  const flows: Flow[] = borrowers.map((b, i) => {
    const dx = b.x - payer.x;
    const dy = b.y - payer.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    return {
      to: b,
      sx: payer.x + ux * (payer.r + 4),
      sy: payer.y + uy * (payer.r + 4),
      tx: b.x - ux * (b.r + 7),
      ty: b.y - uy * (b.r + 7),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      start: 0.9 + i * stagger,
    };
  });

  const end = flows.length ? flows[flows.length - 1].start + 1.2 : 0.8;
  return { payer, borrowers, flows, end };
}

function BubbleNode({
  b,
  delay,
  clipId,
  sub,
  subColor,
  subDelay,
}: {
  b: Bubble;
  delay: number;
  clipId: string;
  sub: string;
  subColor: string;
  subDelay: number;
}) {
  const color = colorForName(b.fullName);
  // Labels go on the side away from the payer so the flow lines never cross them.
  const above = b.y < C - 1;
  const nameY = above ? -(b.r + 24) : b.r + 16;
  const subY = above ? -(b.r + 9) : b.r + 31;
  return (
    <g transform={`translate(${b.x},${b.y})`}>
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay, type: "spring", stiffness: 320, damping: 17 }}
      >
        <circle r={b.r + 3} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={2} />
        <circle r={b.r} fill={color} />
        {b.avatar ? (
          <>
            <clipPath id={clipId}>
              <circle r={b.r} />
            </clipPath>
            <image
              href={b.avatar}
              x={-b.r}
              y={-b.r}
              width={b.r * 2}
              height={b.r * 2}
              clipPath={`url(#${clipId})`}
              preserveAspectRatio="xMidYMid slice"
            />
          </>
        ) : (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={b.r * 0.72}
            fontWeight={800}
            fill="#fff"
          >
            {initials(b.fullName)}
          </text>
        )}
        <text
          y={nameY}
          textAnchor="middle"
          fontSize={12.5}
          fontWeight={700}
          fill="rgba(255,255,255,0.92)"
          stroke="rgba(20,14,6,0.85)"
          strokeWidth={3}
          style={{ paintOrder: "stroke" }}
        >
          {short(b.name)}
        </text>
      </motion.g>
      <g transform={`translate(0,${subY})`}>
        <motion.text
          textAnchor="middle"
          fontSize={11.5}
          fontWeight={700}
          fill={subColor}
          stroke="rgba(20,14,6,0.85)"
          strokeWidth={3}
          style={{ paintOrder: "stroke" }}
          initial={{ opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: subDelay, duration: 0.3 }}
        >
          {sub}
        </motion.text>
      </g>
    </g>
  );
}

function Stage({ expense, members, myId, currency }: StageProps) {
  const uid = useId().replace(/:/g, "");
  const { payer, borrowers, flows, end } = useMemo(
    () => layout(expense, members, myId),
    [expense, members, myId]
  );
  const money = (v: number) => formatMoney(currency, v);

  return (
    <>
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="mx-auto block w-full max-w-[380px]"
        role="img"
        aria-label={`${payer.name} paid ${money(expense.amount)} for ${borrowers.length} people`}
      >
        <defs>
          <linearGradient id={`${uid}-edge`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={S} y2="0">
            <stop offset="0" stopColor="#ff8a3d" />
            <stop offset="1" stopColor="#ffc23d" />
          </linearGradient>
          <radialGradient id={`${uid}-glow`}>
            <stop offset="0" stopColor="#ff8a3d" stopOpacity={0.35} />
            <stop offset="1" stopColor="#ff8a3d" stopOpacity={0} />
          </radialGradient>
        </defs>

        <motion.circle
          cx={payer.x}
          cy={payer.y}
          r={payer.r * 2.6}
          fill={`url(#${uid}-glow)`}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.55] }}
          transition={{ delay: 0.5, duration: 1.2 }}
        />

        {flows.map((f, i) => (
          <g key={f.to.id}>
            <motion.line
              x1={f.sx}
              y1={f.sy}
              x2={f.tx}
              y2={f.ty}
              stroke={`url(#${uid}-edge)`}
              strokeOpacity={0.6}
              strokeWidth={2.5}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: f.start, duration: 0.45, ease: "easeOut" }}
            />
            <motion.polygon
              points="0,-5 9,0 0,5"
              fill="#ffc23d"
              transform={`translate(${f.tx},${f.ty}) rotate(${f.angle})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: f.start + 0.4, duration: 0.2 }}
            />
            {[0, 1, 2].map((j) => (
              <motion.circle
                key={j}
                r={j === 0 ? 6 : 4.5}
                fill={COIN}
                stroke="#ff9a3d"
                strokeWidth={1.5}
                initial={{ cx: f.sx, cy: f.sy, opacity: 0 }}
                animate={{ cx: [f.sx, f.tx], cy: [f.sy, f.ty], opacity: [0, 1, 1, 0] }}
                transition={{ delay: f.start + 0.15 + j * 0.13, duration: 0.75, ease: "easeInOut" }}
              />
            ))}
            {/* Ripple on the receiving bubble as the money lands. */}
            <motion.circle
              cx={f.to.x}
              cy={f.to.y}
              fill="none"
              stroke={COIN}
              strokeWidth={2}
              initial={{ r: f.to.r, opacity: 0 }}
              animate={{ r: [f.to.r, f.to.r + 14], opacity: [0.9, 0] }}
              transition={{ delay: f.start + 0.85, duration: 0.6, ease: "easeOut" }}
            />
            <BubbleNode
              b={f.to}
              delay={0.3 + i * 0.06}
              clipId={`${uid}-c${i}`}
              sub={money(f.to.share)}
              subColor={OWES}
              subDelay={f.start + 0.85}
            />
          </g>
        ))}

        <BubbleNode
          b={payer}
          delay={0}
          clipId={`${uid}-payer`}
          sub={`paid ${money(expense.amount)}`}
          subColor="#6ee7b7"
          subDelay={0.45}
        />
      </svg>

      <motion.div
        className="mt-3 space-y-1.5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: end, duration: 0.35 }}
      >
        {borrowers.length === 0 ? (
          <p className="text-center text-sm text-white/55">
            {payer.name} paid for {payer.name === "You" ? "yourself" : "themselves"} — nothing to split.
          </p>
        ) : (
          <>
            {borrowers.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-white/80">
                  <b className="text-white">{b.name}</b> {b.name === "You" ? "owe" : "owes"}{" "}
                  <b className="text-white">{payer.name}</b>
                </span>
                <span className="shrink-0 font-bold text-rose-300">{money(b.share)}</span>
              </div>
            ))}
            {payer.share > 0.004 && (
              <p className="pt-1 text-center text-xs text-white/45">
                {payer.name === "You" ? "Your" : `${payer.name}'s`} own share: {money(payer.share)}
              </p>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}

type StageProps = {
  expense: Expense;
  members: PublicUser[];
  myId: string;
  currency: string;
};

// Plays how one expense moved money: the payer's bubble in the middle sends
// coins out to each person whose share they covered, then lists who owes what.
export function ExpenseFlowModal({
  open,
  onClose,
  expense,
  ...stage
}: Omit<StageProps, "expense"> & {
  open: boolean;
  onClose: () => void;
  expense: Expense | null;
}) {
  const [run, setRun] = useState(0);
  const cat = expense ? categoryMeta(expense.category) : null;

  return (
    <Modal
      open={open && !!expense}
      onClose={onClose}
      title={
        expense && (
          <span className="flex min-w-0 items-center gap-2">
            <span>{cat?.emoji}</span>
            <span className="truncate">{expense.title}</span>
          </span>
        )
      }
      footer={
        <Button className="w-full" onClick={() => setRun((r) => r + 1)}>
          <Play className="h-4 w-4" /> Play again
        </Button>
      }
    >
      {expense && (
        <MotionConfig reducedMotion="user">
          <Stage key={`${expense.id}-${run}`} expense={expense} {...stage} />
        </MotionConfig>
      )}
    </Modal>
  );
}
