// Pure split math shared by the web app, the API and (mirrored) the mobile app.
// Given a total amount, a split mode and per-participant inputs, it returns the
// exact currency amount each participant owes — always summing back to the total
// (any rounding residual is absorbed by the largest share).

export type SplitMode = "equal" | "exact" | "percent" | "shares";

export type ShareInput = {
  userId: string;
  included: boolean;
  // exact → amount owed; percent → 0-100; shares → weight. Ignored for equal.
  value?: number;
};

export type ComputedShare = { userId: string; amount: number };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeShares(
  amount: number,
  mode: SplitMode,
  inputs: ShareInput[]
): ComputedShare[] {
  const active = inputs.filter((s) => s.included);
  if (active.length === 0 || amount <= 0) {
    return active.map((s) => ({ userId: s.userId, amount: 0 }));
  }

  let raw: ComputedShare[];

  switch (mode) {
    case "exact": {
      raw = active.map((s) => ({ userId: s.userId, amount: round2(s.value ?? 0) }));
      break;
    }
    case "percent": {
      raw = active.map((s) => ({
        userId: s.userId,
        amount: round2((amount * (s.value ?? 0)) / 100),
      }));
      break;
    }
    case "shares": {
      const totalWeight = active.reduce((sum, s) => sum + (s.value ?? 0), 0);
      if (totalWeight <= 0) return computeShares(amount, "equal", inputs);
      raw = active.map((s) => ({
        userId: s.userId,
        amount: round2((amount * (s.value ?? 0)) / totalWeight),
      }));
      break;
    }
    case "equal":
    default: {
      const each = round2(amount / active.length);
      raw = active.map((s) => ({ userId: s.userId, amount: each }));
      break;
    }
  }

  // Absorb any rounding residual into the largest share so shares always add up.
  const sum = raw.reduce((acc, s) => acc + s.amount, 0);
  const residual = round2(amount - sum);
  if (residual !== 0 && raw.length > 0) {
    let idx = 0;
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].amount > raw[idx].amount) idx = i;
    }
    raw[idx] = { ...raw[idx], amount: round2(raw[idx].amount + residual) };
  }

  return raw;
}

// Returns a human message if inputs won't produce a valid total, else null.
export function validateSplit(
  amount: number,
  mode: SplitMode,
  inputs: ShareInput[]
): string | null {
  const active = inputs.filter((s) => s.included);
  if (active.length === 0) return "Include at least one person.";
  if (mode === "exact") {
    const total = round2(active.reduce((s, x) => s + (x.value ?? 0), 0));
    if (total !== round2(amount)) {
      return `Exact amounts add up to ${total}, but the total is ${round2(amount)}.`;
    }
  }
  if (mode === "percent") {
    const total = round2(active.reduce((s, x) => s + (x.value ?? 0), 0));
    if (total !== 100) return `Percentages add up to ${total}%, they must total 100%.`;
  }
  if (mode === "shares") {
    const total = active.reduce((s, x) => s + (x.value ?? 0), 0);
    if (total <= 0) return "Enter at least one share.";
  }
  return null;
}
