/**
 * Spreading one entry across several months.
 *
 * A property-tax bill paid once a year, an insurance premium, a tenant who
 * pays six months up front: the money moves on one day, but it belongs to
 * a run of months. An entry can be spread over 2–36 months from a starting
 * month, split evenly to the cent.
 *
 *   - Monthly views (profit, expenses, cash-flow charts, property cards,
 *     totals by LLC) count each month's share.
 *   - Rent status (paid / late, balances, late fees) counts each month's
 *     share toward that month's rent.
 *   - The ledger still lists the one real entry, and the tax export still
 *     goes by the date it was paid — that's when it's deductible or income.
 *
 * Pure, so the client, the server and the tests share it.
 */
import { isMonthKey, rentMonthOf } from "./rent-month.ts";

export const MAX_SPREAD = 36;

export type Spreadable = {
  type: string;
  date: string | Date;
  amount: number;
  /** The month a payment counts toward — and, when spread, the first month. */
  appliesTo?: string | null;
  /** How many months it's spread over; null or 1 is not spread. */
  spreadMonths?: number | null;
};

/** "2026-09" + n */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const isSpread = (t: Spreadable) =>
  typeof t.spreadMonths === "number" && Number.isInteger(t.spreadMonths) && t.spreadMonths > 1 && t.spreadMonths <= MAX_SPREAD;

/** The first month an entry counts in: its chosen month, else the month of its date. */
export function firstMonthOf(t: Spreadable): string {
  return rentMonthOf(t);
}

/**
 * Where an entry's money lands, month by month. An entry that isn't spread
 * lands whole in one month: rent in the month it counts toward, an expense
 * in the month of its date. The shares always add back to the amount exactly
 * — any leftover cents go to the earliest months.
 */
export function allocate(t: Spreadable): { month: string; amount: number }[] {
  if (!isSpread(t)) {
    const month = t.type === "rent" ? rentMonthOf(t) : (typeof t.date === "string" ? t.date : t.date.toISOString()).slice(0, 7);
    return [{ month, amount: t.amount }];
  }
  const n = t.spreadMonths as number;
  const start = firstMonthOf(t);
  const total = Math.round(t.amount * 100);
  const base = Math.trunc(total / n);
  let left = total - base * n;
  const out: { month: string; amount: number }[] = [];
  for (let i = 0; i < n; i++) {
    let c = base;
    if (left > 0) {
      c += 1;
      left -= 1;
    } else if (left < 0) {
      c -= 1;
      left += 1;
    }
    out.push({ month: addMonths(start, i), amount: c / 100 });
  }
  return out;
}

/**
 * The entries as monthly reports should count them: a spread entry becomes
 * one copy per month, dated mid-month with that month's share; everything
 * else passes through untouched. For sums and charts only — never render
 * these as ledger rows.
 */
export function spreadForReports<T extends Spreadable>(txns: readonly T[]): T[] {
  const out: T[] = [];
  for (const t of txns) {
    if (!isSpread(t)) {
      out.push(t);
      continue;
    }
    for (const share of allocate(t)) {
      out.push({ ...t, date: `${share.month}-15`, amount: share.amount, appliesTo: null, spreadMonths: null });
    }
  }
  return out;
}

/** What a form or API sent for "spread over": a count, null to clear, undefined if not sent, false if invalid. */
export function parseSpreadMonths(raw: unknown): number | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "" || raw === 1 || raw === "1" || raw === 0 || raw === "0") return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 2 || n > MAX_SPREAD) return false;
  return n;
}

/** "Spread over 12 months, Jan–Dec 2026 · $300.00 a month" */
export function spreadSummary(t: Spreadable): string {
  if (!isSpread(t)) return "";
  const parts = allocate(t);
  const first = parts[0].month;
  const last = parts[parts.length - 1].month;
  const label = (m: string, withYear: boolean) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", {
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  };
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const range = sameYear ? `${label(first, false)}–${label(last, true)}` : `${label(first, true)} – ${label(last, true)}`;
  const each = parts[0].amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `Spread over ${parts.length} months, ${range} · ${each} a month`;
}

export { isMonthKey };
