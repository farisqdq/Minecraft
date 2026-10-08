/**
 * What a one-tap "Mark paid" / "Log it" button puts in the entry form.
 *
 * Those buttons used to write straight to the ledger. They now open the full
 * rent or expense form with everything the app already knows filled in, so
 * recording the usual payment is still one more tap (Enter, or "Record
 * payment"), but a short payment, a cheque number, a photo of the receipt or
 * a waived late fee no longer means recording it wrong and fixing it after.
 *
 * Pure: no clock, no database — "today" and every figure are handed in, so
 * the dashboard, the calendar and the tests all agree.
 */

import { money } from "./money.ts";

export type QuickType = "rent" | "expense";

/** The fields the entry form starts with. Strings, as the inputs hold them. */
export type EntryPrefill = {
  type: QuickType;
  amount: string;
  /** YYYY-MM-DD */
  date: string;
  /** "Paid by" on rent, "Paid to" on an expense. */
  detail: string;
  note: string;
  category: string;
  /** Rent only: the month it counts toward ("2026-09"). Unset: the month of `date`. */
  appliesTo?: string;
  /** Spread across this many months (lib/spread); unset or 0: not spread. */
  spreadMonths?: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** "September 2026" for "2026-09"; "" for anything that isn't a month key. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return "";
  return MONTH_YEAR.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
}

export function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day `day` of `month`, clamped into it: the 31st of September is the 30th. */
export function dayOf(month: string, day: number): string {
  const d = Math.min(Math.max(1, Math.round(day) || 1), daysIn(month));
  return `${month}-${String(d).padStart(2, "0")}`;
}

/** First and last day of a month, for a date input's min and max. */
export function monthBounds(month: string): { min: string; max: string } {
  return { min: `${month}-01`, max: dayOf(month, 31) };
}

/** Whether a YYYY-MM-DD date falls inside a YYYY-MM month. */
export function dateInMonth(date: string, month: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(`${month}-`) && Number(date.slice(8)) <= daysIn(month);
}

/**
 * What is still owed on a month: rent (plus any standing charges) and the
 * late fees on the books, less what came in. Never negative, to the cent.
 */
export function amountOwed(o: { expected: number; paid: number; fees?: number }): number {
  return Math.max(0, cents(o.expected + (o.fees ?? 0) - o.paid));
}

/** An amount as the input shows it: "1070", "412.6" → "412.60", nothing for zero. */
export function amountField(n: number): string {
  if (!(n > 0) || !Number.isFinite(n)) return "";
  const c = cents(n);
  return Number.isInteger(c) ? String(c) : c.toFixed(2);
}

/**
 * The date a quick entry lands on, which decides the month it counts for.
 * Today when today is in that month; otherwise `fallback` — the 1st on the
 * overview, the due date on the calendar — so paging back to August and
 * marking it paid still books it to August.
 */
export function entryDateFor(month: string, today: string, fallback?: string): string {
  if (today.startsWith(`${month}-`)) return today;
  return fallback && dateInMonth(fallback, month) ? fallback : `${month}-01`;
}

/** "September 2026 rent" — the note a rent entry has always been given. */
export function rentNote(month: string): string {
  return `${monthLabel(month)} rent`;
}

/** The rent form, filled from a row that owes money for `month`. */
export function rentPrefill(o: {
  month: string;
  today: string;
  expected: number;
  paid: number;
  fees?: number;
  tenantName?: string;
  /** Where the month's date falls when today isn't in it. */
  fallbackDate?: string;
}): EntryPrefill {
  return {
    type: "rent",
    amount: amountField(amountOwed(o)),
    date: entryDateFor(o.month, o.today, o.fallbackDate),
    detail: o.tenantName ?? "",
    note: rentNote(o.month),
    category: "",
    // Marking a month paid counts toward that month, whatever date it's
    // recorded on — September's rent paid on October 3rd is still September's.
    appliesTo: o.month,
  };
}

export type RecurringTemplate = {
  amount: number;
  category: string;
  detail: string;
  note: string;
  /** Day of the month the bill is logged on. */
  day: number;
};

/**
 * A recurring bill's form for `month`. It is dated on the bill's own day in
 * that month — where "Log it" has always put it — so it counts for the month
 * it was due, whatever today is.
 */
export function recurringPrefill(t: RecurringTemplate, month: string): EntryPrefill {
  return {
    type: "expense",
    amount: amountField(t.amount),
    date: dayOf(month, t.day),
    detail: t.detail,
    note: t.note,
    category: t.category,
  };
}

/** The words on the form, which change with what it's recording. */
export function entryLabels(type: QuickType, opts: { editing?: boolean; recurring?: boolean } = {}) {
  const rent = type === "rent";
  return {
    title: opts.editing
      ? "Edit this entry"
      : rent
        ? "Record a payment"
        : opts.recurring
          ? "Log this bill"
          : "Record an expense",
    submit: opts.editing ? "Save changes" : rent ? "Record payment" : "Log expense",
    detail: rent ? "Paid by (tenant)" : "Paid to",
    proof: rent ? "Attach proof of payment (optional)" : "Attach receipt or photo (optional)",
  };
}

/** One line per entry and the total, for the "Mark all paid" confirmation. */
export function bulkSummary(rows: { name: string; owed: number }[]) {
  const lines = rows.filter((r) => r.owed > 0).map((r) => ({ name: r.name, owed: cents(r.owed) }));
  const total = cents(lines.reduce((s, r) => s + r.owed, 0));
  return {
    lines,
    total,
    text: lines.map((r) => `${r.name}: ${money(r.owed)}`),
  };
}

export type RecurringOverrides = {
  amount?: number;
  date?: string;
  detail?: string;
  note?: string;
  category?: string;
};

/**
 * Reads the optional overrides on a "log this recurring bill" request. The
 * month is fixed by the request; a date, if sent, must fall inside it, so an
 * edited entry still counts as that month's bill and the once-a-month check
 * keeps working.
 */
export function parseRecurringOverrides(
  body: unknown,
  month: string,
  validCategory: (c: string) => boolean
): { ok: true; value: RecurringOverrides } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: RecurringOverrides = {};
  if (b.amount !== undefined) {
    const n = Number(b.amount);
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return { ok: false, error: "Enter an amount above zero." };
    out.amount = cents(n);
  }
  if (b.date !== undefined) {
    if (typeof b.date !== "string" || !dateInMonth(b.date, month)) {
      return { ok: false, error: `Pick a date in ${monthLabel(month)} — this logs that month's bill.` };
    }
    out.date = b.date;
  }
  if (b.category !== undefined) {
    if (typeof b.category !== "string" || !validCategory(b.category)) {
      return { ok: false, error: "Pick a category for this expense." };
    }
    out.category = b.category;
  }
  if (typeof b.detail === "string") out.detail = b.detail.trim().slice(0, 500);
  if (typeof b.note === "string") out.note = b.note.trim().slice(0, 1000);
  return { ok: true, value: out };
}

/** "$1,000 rent + $70 late fees, $400 paid so far" — how a prefilled amount was reached. */
export function owedLine(o: { expected: number; paid: number; fees?: number }, what = "rent"): string {
  const fees = cents(o.fees ?? 0);
  let line = `${money(cents(o.expected))} ${what}`;
  if (fees > 0) line += ` + ${money(fees)} late ${fees === 1 ? "fee" : "fees"}`;
  if (o.paid > 0.005) line += `, ${money(cents(o.paid))} paid so far`;
  return line;
}
