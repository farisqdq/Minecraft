/**
 * The next twelve months of money, from what the app already knows.
 *
 * Rent comes from the rent history — so a raise renewed ahead of time is in
 * its month — for every place that isn't marked vacant. Rent past a lease
 * end with no renewal is still counted (most tenants stay on), but said
 * separately as at risk, because that is the money a landlord should be
 * thinking about now. Recurring bills land in their months, a yearly one in
 * its one month, which is what makes some months short. Mortgage payments
 * are what leaves the account — principal, interest and escrow — until the
 * loan is paid off. Everything else (repairs, supplies, the bills nobody
 * set up as recurring) is the last twelve months' average, labelled as
 * such, because a forecast that assumed nothing breaks would be a promise.
 *
 * Pure: no database and no clock.
 */

import { rentForMonth, type RentChangeDTO } from "./rent.ts";
import { currentBalance, splitPayment, type LoanPaymentLike, type LoanTerms } from "./loans.ts";

export type ForecastPlace = { propertyId: string; unitId: string | null; rent: number; vacant: boolean };
export type ForecastTenant = { name: string; propertyId: string; unitId: string | null; leaseEnd: string; active: boolean };
export type ForecastBill = {
  propertyId: string;
  category: string;
  detail: string;
  amount: number;
  frequency: "monthly" | "yearly";
  /** 1-12, for a yearly bill. */
  month: number | null;
  active: boolean;
};
export type ForecastLoan = LoanTerms & { propertyId: string; lender: string; active: boolean; payments: LoanPaymentLike[] };
export type ForecastEntry = {
  type: "rent" | "expense";
  date: string;
  amount: number;
  recurringExpenseId: string | null;
  loanPaymentId: string | null;
};

export type ForecastLine = { label: string; amount: number };

export type ForecastMonth = {
  month: string;
  rent: number;
  /** Rent counted from places whose every current lease has ended by then. */
  atRisk: number;
  bills: number;
  mortgage: number;
  other: number;
  out: number;
  net: number;
  /** Bills and mortgage payments that month, largest first. */
  lines: ForecastLine[];
};

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;

export function addMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * What was spent each month, on average, outside recurring bills and
 * mortgage payments: the repairs, supplies and one-off bills a forecast
 * would otherwise pretend won't happen. Over the twelve full months before
 * `thisMonth`, or since the books began if that's sooner.
 */
export function otherSpending(entries: ForecastEntry[], thisMonth: string): { perMonth: number; months: number } {
  const start = addMonth(thisMonth, -12);
  let first = "";
  let total = 0;
  for (const e of entries) {
    const m = e.date.slice(0, 7);
    if (!first || m < first) first = m;
    if (e.type !== "expense" || e.recurringExpenseId || e.loanPaymentId) continue;
    if (m < start || m >= thisMonth) continue;
    total += cents(e.amount);
  }
  if (!first || first >= thisMonth) return { perMonth: 0, months: 0 };
  const from = first > start ? first : start;
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = thisMonth.split("-").map(Number);
  const months = Math.max(1, ty * 12 + tm - (fy * 12 + fm));
  return { perMonth: Math.round(total / months) / 100, months };
}

export function forecast(input: {
  /** The first month forecast, YYYY-MM. */
  from: string;
  months: number;
  places: ForecastPlace[];
  tenants: ForecastTenant[];
  rentChanges: RentChangeDTO[];
  bills: ForecastBill[];
  loans: ForecastLoan[];
  /** Average other spending per month (otherSpending). */
  otherPerMonth: number;
}): { months: ForecastMonth[]; rent: number; out: number; net: number; atRisk: number; lowest: ForecastMonth | null } {
  // Each loan's payments month by month, the balance carried along, so the
  // last one is only what's left and nothing is paid after it.
  const loanCash = new Map<string, { label: string; amount: number }[]>();
  for (const l of input.loans) {
    if (!l.active) continue;
    const paid = new Set(l.payments.map((p) => p.month));
    let owed = currentBalance(l.balance, l.payments);
    const escrow = cents(l.escrowTax) + cents(l.escrowInsurance);
    for (let i = 0; i < input.months && owed > 0; i++) {
      const month = addMonth(input.from, i);
      if (month < l.balanceAsOf || paid.has(month)) continue;
      const split = splitPayment(owed, l.rate, l.payment);
      owed = dollars(cents(owed) - cents(split.principal));
      // A payment that doesn't even cover the interest still leaves the
      // account in full; it just never pays anything off.
      const pi = split.principal > 0 ? cents(split.interest) + cents(split.principal) : cents(l.payment);
      const amount = dollars(pi + escrow);
      loanCash.set(month, [...(loanCash.get(month) ?? []), { label: `${l.lender || "Mortgage"} payment`, amount }]);
    }
  }

  const months: ForecastMonth[] = [];
  for (let i = 0; i < input.months; i++) {
    const month = addMonth(input.from, i);
    const firstDay = `${month}-01`;
    let rent = 0;
    let atRisk = 0;
    for (const p of input.places) {
      if (p.vacant) continue;
      const amount = cents(rentForMonth(input.rentChanges, p.propertyId, p.unitId, month, p.rent));
      if (amount <= 0) continue;
      rent += amount;
      const here = input.tenants.filter((t) => t.active && t.propertyId === p.propertyId && (t.unitId ?? null) === (p.unitId ?? null));
      if (here.length > 0 && here.every((t) => t.leaseEnd && t.leaseEnd < firstDay)) atRisk += amount;
    }

    const lines: ForecastLine[] = [];
    let bills = 0;
    for (const b of input.bills) {
      if (!b.active) continue;
      if (b.frequency === "yearly" && b.month !== Number(month.slice(5, 7))) continue;
      bills += cents(b.amount);
      lines.push({ label: b.detail ? `${b.detail} (${b.category})` : b.category, amount: b.amount });
    }
    let mortgage = 0;
    for (const line of loanCash.get(month) ?? []) {
      mortgage += cents(line.amount);
      lines.push(line);
    }
    const other = cents(input.otherPerMonth);
    const out = bills + mortgage + other;
    lines.sort((a, b) => b.amount - a.amount);
    months.push({
      month,
      rent: dollars(rent),
      atRisk: dollars(atRisk),
      bills: dollars(bills),
      mortgage: dollars(mortgage),
      other: dollars(other),
      out: dollars(out),
      net: dollars(rent - out),
      lines,
    });
  }

  const sum = (f: (m: ForecastMonth) => number) => dollars(months.reduce((s, m) => s + cents(f(m)), 0));
  const lowest = months.reduce<ForecastMonth | null>((low, m) => (!low || m.net < low.net ? m : low), null);
  return { months, rent: sum((m) => m.rent), out: sum((m) => m.out), net: sum((m) => m.net), atRisk: sum((m) => m.atRisk), lowest };
}
