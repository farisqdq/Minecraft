/**
 * Renewing a lease, and the rent change that usually comes with it.
 *
 * The rent change is the part that costs money when it goes wrong. A raise
 * agreed in October to start in January used to have nowhere to go: editing
 * the rent applies it from the current month, so either the tenant was
 * charged the new figure three months early or the landlord had to remember
 * to come back on January 1st. A renewal writes the new figure into the rent
 * history from the month it starts, so every month is judged by what it
 * should be, the day it arrives, with nobody remembering anything.
 *
 * Pure: no database and no clock.
 */

import { MAX_AMOUNT, money } from "./money.ts";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseDay(s: string): Date | null {
  if (!ISO_DAY.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** The same day a number of years on; Feb 29 becomes Feb 28. */
function addYears(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * What the renewal form starts with: another year on the lease, and the new
 * rent from the first month after the current lease ends — or next month,
 * when the lease has already run out or has no end on file.
 */
export function renewalDefaults(o: { leaseEnd: string; today: string }): { newEnd: string; rentFrom: string } {
  const thisMonth = o.today.slice(0, 7);
  const end = o.leaseEnd && parseDay(o.leaseEnd) ? o.leaseEnd : "";
  if (end && end >= o.today) {
    // The month after the one the lease ends in. A lease ending on the last
    // day of December renews from January.
    const rentFrom = addMonths(end.slice(0, 7), 1);
    return { newEnd: addYears(end, 1), rentFrom };
  }
  // Ended already, or open-ended: a year from the end of this month.
  const nextMonth = addMonths(thisMonth, 1);
  const lastOfThisYearOn = new Date(Date.parse(`${addMonths(nextMonth, 12)}-01T00:00:00Z`) - 86_400_000);
  return { newEnd: iso(lastOfThisYearOn), rentFrom: nextMonth };
}

/** Rounded to the nearest $5 — how rents are quoted — and never below a dollar. */
export function roundRent(n: number): number {
  return Math.max(1, Math.round(n / 5) * 5);
}

/** The shortcuts beside the rent box: keep it, or a typical raise. */
export function raiseOptions(current: number): { label: string; amount: number }[] {
  if (!(current > 0)) return [];
  const out = [{ label: `Keep ${money(current)}`, amount: current }];
  for (const pct of [3, 5]) {
    const amount = roundRent(current * (1 + pct / 100));
    if (amount !== current && !out.some((o) => o.amount === amount)) out.push({ label: `+${pct}%`, amount });
  }
  return out;
}

/** "+$75 a month · +$900 a year · +5.2%" — or the same for a cut. */
export function changeSummary(from: number, to: number): string {
  if (from === to) return "Rent stays the same.";
  const diff = Math.round((to - from) * 100) / 100;
  const sign = diff > 0 ? "+" : "−";
  const abs = Math.abs(diff);
  const pct = from > 0 ? ` · ${sign}${(Math.round((abs / from) * 1000) / 10).toFixed(1)}%` : "";
  return `${sign}${money(abs)} a month · ${sign}${money(Math.round(abs * 12 * 100) / 100)} a year${pct}`;
}

/** Days of written notice asked for before a rent change, unless the lease says otherwise. */
export const NOTICE_DAYS = 30;

/** The last day notice can go out for a change starting with `rentFrom`'s rent. */
export function noticeBy(rentFrom: string, days = NOTICE_DAYS): string {
  return iso(new Date(Date.parse(`${rentFrom}-01T00:00:00Z`) - days * 86_400_000));
}

export type RenewalInput = { newEnd: string; newRent: number; rentFrom: string; note: string };

/**
 * Checks a renewal before anything is written. `previousEnd` is the lease
 * end on file now ("" when none); `today` is YYYY-MM-DD.
 */
export function parseRenewal(
  body: unknown,
  ctx: { previousEnd: string; today: string }
): { ok: true; value: RenewalInput } | { ok: false; error: string } {
  const o = (body ?? {}) as Record<string, unknown>;
  const newEnd = typeof o.newEnd === "string" ? o.newEnd : "";
  const rentFrom = typeof o.rentFrom === "string" ? o.rentFrom : "";
  const newRent = Number(o.newRent);
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 500) : "";
  if (!parseDay(newEnd)) return { ok: false, error: "Choose the date the renewed lease ends." };
  if (newEnd <= ctx.today) return { ok: false, error: "The renewed lease has to end after today." };
  if (ctx.previousEnd && newEnd <= ctx.previousEnd) {
    return { ok: false, error: "The renewed lease has to end after the current one does." };
  }
  if (!Number.isFinite(newRent) || newRent <= 0 || newRent > MAX_AMOUNT) {
    return { ok: false, error: "Enter the monthly rent for the renewed lease." };
  }
  if (!MONTH.test(rentFrom)) return { ok: false, error: "Choose the month the new rent starts." };
  // Months already begun have been judged at the old rent; re-judging them
  // is what the rent history exists to prevent.
  if (rentFrom < ctx.today.slice(0, 7)) return { ok: false, error: "The new rent can't start in a month that's already passed." };
  if (rentFrom > newEnd.slice(0, 7)) return { ok: false, error: "The new rent has to start before the renewed lease ends." };
  return { ok: true, value: { newEnd, newRent: Math.round(newRent * 100) / 100, rentFrom, note } };
}

export type ScheduledChange = { id: string; propertyId: string; unitId: string | null; effectiveFrom: string; amount: number };

/**
 * Which places' current rent should now read differently, given rent
 * changes that were set up ahead of time and have come due. For each place
 * the latest due change wins; a later change already in force for that
 * place (someone edited the rent since) means nothing is flipped.
 *
 * `latestInForce` is the newest change per place with effectiveFrom up to
 * this month, keyed "propertyId|unitId".
 */
export function dueRentFlips(
  due: ScheduledChange[],
  latestInForce: Map<string, { id: string }>
): { propertyId: string; unitId: string | null; amount: number | null; ids: string[] }[] {
  const byPlace = new Map<string, ScheduledChange[]>();
  for (const c of due) {
    const key = `${c.propertyId}|${c.unitId ?? ""}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), c]);
  }
  const out: { propertyId: string; unitId: string | null; amount: number | null; ids: string[] }[] = [];
  for (const [key, list] of byPlace) {
    list.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const newest = list[list.length - 1];
    const inForce = latestInForce.get(key);
    // Every due row is marked applied either way, so none is looked at
    // twice; `amount` is null when a later edit already set the rent.
    out.push({
      propertyId: newest.propertyId,
      unitId: newest.unitId,
      amount: inForce && inForce.id !== newest.id ? null : newest.amount,
      ids: list.map((c) => c.id),
    });
  }
  return out;
}

/** "Jan 2027" style label for a month, without a time zone in sight. */
export function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "January 5, 2027" — the day a month's rent falls due; a 31st is the month's last day. */
export function dueDayLong(month: string, dueDay = 1): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(Math.max(1, dueDay), last))).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The words of the renewal notice, as one message — what's sent to the
 * tenant's thread and what the printable letter says.
 */
export function renewalMessage(o: {
  tenantName: string;
  place: string;
  previousEnd: string;
  newEnd: string;
  previousRent: number;
  newRent: number;
  rentFrom: string;
  dueDay: number;
  companyName: string;
  note: string;
}): string {
  const first = o.tenantName.trim().split(/\s+/)[0] || o.tenantName;
  const longDay = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const lines = [
    `Hi ${first},`,
    "",
    o.previousEnd
      ? `Your lease at ${o.place}, which runs to ${longDay(o.previousEnd)}, is renewed through ${longDay(o.newEnd)}.`
      : `Your lease at ${o.place} is renewed through ${longDay(o.newEnd)}.`,
  ];
  if (o.newRent !== o.previousRent) {
    lines.push(
      `Starting with the rent due ${dueDayLong(o.rentFrom, o.dueDay)}, the monthly rent will be ${money(o.newRent)} (it is ${money(o.previousRent)} now).`
    );
  } else {
    lines.push(`The rent stays at ${money(o.newRent)} a month.`);
  }
  lines.push("Everything else in your lease stays the same.");
  if (o.note) lines.push("", o.note);
  lines.push("", `— ${o.companyName}`);
  return lines.join("\n");
}
