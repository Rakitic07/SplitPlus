import { round2 } from "./split";
import type { Balance, Debt, PublicUser } from "./types";

type BalExpense = {
  paidById: string;
  amount: number;
  shares: { userId: string; amount: number }[];
};

type BalSettlement = { fromId: string; toId: string; amount: number };

// Net balance per member. Convention: net > 0 → the member is OWED money
// (a creditor); net < 0 → the member OWES money (a debtor). All nets sum to ~0.
//
//   net = (paid for expenses) − (own share of expenses)
//         + (cash paid out in approved settlements) − (cash received)
export function computeBalances(
  members: PublicUser[],
  expenses: BalExpense[],
  settlements: BalSettlement[]
): Balance[] {
  const net = new Map<string, number>();
  for (const m of members) net.set(m.id, 0);
  const add = (id: string, v: number) => net.set(id, (net.get(id) ?? 0) + v);

  for (const e of expenses) {
    add(e.paidById, e.amount);
    for (const s of e.shares) add(s.userId, -s.amount);
  }
  for (const s of settlements) {
    add(s.fromId, s.amount);
    add(s.toId, -s.amount);
  }

  return members.map((m) => ({ ...m, net: round2(net.get(m.id) ?? 0) }));
}

// Greedily turn a set of net balances into the minimum-ish set of
// "who pays whom" transfers: match the biggest debtor to the biggest creditor
// until everyone is squared away.
export function simplifyDebts(balances: Balance[]): Debt[] {
  const creditors = balances
    .filter((b) => b.net > 0.005)
    .map((b) => ({ id: b.id, name: b.name, amt: b.net }))
    .sort((a, b) => b.amt - a.amt);
  const debtors = balances
    .filter((b) => b.net < -0.005)
    .map((b) => ({ id: b.id, name: b.name, amt: -b.net }))
    .sort((a, b) => b.amt - a.amt);

  const debts: Debt[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const cred = creditors[ci];
    const deb = debtors[di];
    const pay = round2(Math.min(cred.amt, deb.amt));
    if (pay > 0) {
      debts.push({
        fromId: deb.id,
        fromName: deb.name,
        toId: cred.id,
        toName: cred.name,
        amount: pay,
      });
    }
    cred.amt = round2(cred.amt - pay);
    deb.amt = round2(deb.amt - pay);
    if (cred.amt <= 0.005) ci++;
    if (deb.amt <= 0.005) di++;
  }
  return debts;
}
