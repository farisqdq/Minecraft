/**
 * Which month a rent payment counts toward.
 *
 * A payment can be marked as applying to a month other than the one it
 * arrived in: September's rent paid on October 3rd, or October's paid early
 * on September 28th. Rent status — who's paid, who's late, balances, late
 * fees — goes by that month. Cash flow and the tax export go by the date the
 * money came in, and should keep calling the date, not this.
 *
 * Pure, so the client, the server and the tests share it.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonthKey = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);

/** The month of an ISO date string or a Date, by the UTC calendar the app stores dates in. */
function monthOfDate(date: string | Date): string {
  return typeof date === "string" ? date.slice(0, 7) : date.toISOString().slice(0, 7);
}

/** The month a payment counts toward: its chosen month, or else the month it arrived in. */
export function rentMonthOf(t: { date: string | Date; appliesTo?: string | null }): string {
  return isMonthKey(t.appliesTo) ? t.appliesTo : monthOfDate(t.date);
}

/**
 * The day a payment should be treated as on hand for late-fee purposes.
 * Paid late for an earlier month: the day it really arrived (it was late).
 * Paid early for a later month: the 1st of that month (it was there in time).
 */
export function effectivePaymentDay(t: { date: string | Date; appliesTo?: string | null }): string {
  const day = typeof t.date === "string" ? t.date.slice(0, 10) : t.date.toISOString().slice(0, 10);
  if (!isMonthKey(t.appliesTo)) return day;
  const first = `${t.appliesTo}-01`;
  return day < first ? first : day;
}

/**
 * What a form or API sent for "applies to": a month, "" / null to clear it,
 * or undefined when it wasn't sent. A month equal to the payment's own month
 * is stored as null — it already counts there, and one meaning should have
 * one representation. Returns false when the value is invalid.
 */
export function parseAppliesTo(raw: unknown, date: Date): string | null | undefined | false {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (!isMonthKey(raw)) return false;
  return raw === date.toISOString().slice(0, 7) ? null : raw;
}

/** "2026-09" → "September 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
