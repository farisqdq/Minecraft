/**
 * Driving to your rentals is deductible, and almost nobody records it.
 *
 * Schedule E has a line for auto and travel (line 6). A landlord who drives
 * to a property to meet a plumber, show an empty unit, or pick up supplies
 * can deduct those miles at the IRS standard mileage rate — 76¢ a mile in
 * the second half of 2026 — which on a few thousand miles a year is a
 * four-figure deduction. It needs a log kept at the time: the date, where,
 * why, and how far. That's what a trip is here.
 *
 * Like depreciation, no money moves, so trips aren't in the ledger or the
 * overview's profit; they're on the tax export, per property, with the log
 * itself listed so it can be handed over as the record.
 *
 * The rate is the one in force on the day of the trip. The IRS usually sets
 * one rate a year, but not always — in 2022 and again in 2026 it raised the
 * rate on July 1 because of fuel prices — so the table below is by date.
 * The standard rate can't be used for a car whose actual costs or
 * depreciation are being deducted; the page says so.
 *
 * Pure: no database and no clock. Works in cents.
 */

/** Business standard mileage rates, in cents a mile, from the day each took effect. */
export const RATES: { from: string; cents: number; source: string }[] = [
  { from: "2018-01-01", cents: 54.5, source: "Notice 2018-03" },
  { from: "2019-01-01", cents: 58, source: "Notice 2019-02" },
  { from: "2020-01-01", cents: 57.5, source: "Notice 2020-05" },
  { from: "2021-01-01", cents: 56, source: "Notice 2021-02" },
  { from: "2022-01-01", cents: 58.5, source: "Notice 2022-03" },
  { from: "2022-07-01", cents: 62.5, source: "Announcement 2022-13" },
  { from: "2023-01-01", cents: 65.5, source: "Notice 2023-03" },
  { from: "2024-01-01", cents: 67, source: "Notice 2024-08" },
  { from: "2025-01-01", cents: 70, source: "Notice 2025-05" },
  { from: "2026-01-01", cents: 72.5, source: "Notice 2026-10" },
  { from: "2026-07-01", cents: 76, source: "Announcement 2026-11" },
];

/** One trip's miles: more than this is a typo, not a drive to a rental. */
export const MAX_TRIP_MILES = 2000;

export type Rate = {
  cents: number;
  /** The day this rate took effect. */
  from: string;
  source: string;
  /**
   * False when the trip's year is past the last rate this app knows — the
   * IRS hasn't published it yet, or the app hasn't been told. The latest
   * known rate is used meanwhile, and the page says so.
   */
  published: boolean;
};

/** The rate for a trip on `day` (YYYY-MM-DD), or null before 2018. */
export function rateOn(day: string): Rate | null {
  let found: (typeof RATES)[number] | null = null;
  for (const r of RATES) if (r.from <= day) found = r;
  if (!found) return null;
  const last = RATES[RATES.length - 1];
  return { ...found, published: day.slice(0, 4) <= last.from.slice(0, 4) };
}

export type TripLike = { date: string; miles: number; propertyId: string };

/**
 * Miles × rate, worked per rate rather than per trip: the deduction for
 * 1,000 miles is the same whether they were logged as one trip or a
 * hundred, as an accountant multiplying total miles by the rate would get.
 */
export function deductionFor(trips: Pick<TripLike, "date" | "miles">[]): {
  miles: number;
  amount: number;
  byRate: { cents: number; from: string; miles: number; amount: number }[];
  unpublished: boolean;
} {
  const groups = new Map<string, { cents: number; from: string; tenths: number }>();
  let tenths = 0;
  let unpublished = false;
  for (const t of trips) {
    const rate = rateOn(t.date);
    const m = Math.round(t.miles * 10);
    tenths += m;
    if (!rate) continue;
    if (!rate.published) unpublished = true;
    const g = groups.get(rate.from) ?? { cents: rate.cents, from: rate.from, tenths: 0 };
    g.tenths += m;
    groups.set(rate.from, g);
  }
  // tenths of a mile × cents a mile ÷ 10 = cents, rounded once per rate.
  const byRate = [...groups.values()]
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((g) => ({ cents: g.cents, from: g.from, miles: g.tenths / 10, amountCents: Math.round((g.tenths * g.cents) / 10) }));
  return {
    miles: tenths / 10,
    amount: byRate.reduce((sum, r) => sum + r.amountCents, 0) / 100,
    byRate: byRate.map(({ amountCents, ...r }) => ({ ...r, amount: amountCents / 100 })),
    unpublished,
  };
}

/** Each property's miles and deduction for a year, and the year's total as their sum. */
export function yearSummary<T extends TripLike>(trips: T[], year: number) {
  const inYear = trips.filter((t) => t.date.startsWith(`${year}-`));
  const ids = [...new Set(inYear.map((t) => t.propertyId))];
  const byProperty = new Map(ids.map((id) => [id, deductionFor(inYear.filter((t) => t.propertyId === id))]));
  let tenths = 0;
  let cents = 0;
  for (const d of byProperty.values()) {
    tenths += Math.round(d.miles * 10);
    cents += Math.round(d.amount * 100);
  }
  return {
    trips: inYear.length,
    miles: tenths / 10,
    amount: cents / 100,
    byProperty,
    unpublished: [...byProperty.values()].some((d) => d.unpublished),
  };
}

/** What people drive to a rental for, offered as suggestions. */
export const PURPOSES = [
  "Repair or maintenance",
  "Showing to a prospective tenant",
  "Inspection",
  "Meeting a contractor",
  "Supplies for the property",
  "Move-in or move-out",
  "Collecting rent",
] as const;

/* ---- input ---- */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type TripInput = { date: string; miles: number; purpose: string; note: string };

/**
 * A trip as typed. The purpose is required: a mileage log without one isn't
 * one the IRS accepts. Miles are kept to a tenth, as odometers read.
 */
export function parseTripInput(
  body: unknown,
  latest: string
): { ok: true; value: TripInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const date = typeof b.date === "string" ? b.date.trim() : "";
  if (!isDay(date)) return { ok: false, error: "Pick the day of the trip." };
  if (date > latest) return { ok: false, error: "A trip can't be in the future." };
  if (!rateOn(date)) return { ok: false, error: "Trips before 2018 can't be logged here." };
  const raw = typeof b.miles === "number" ? b.miles : Number(String(b.miles ?? "").replace(/[,\s]/g, ""));
  const miles = Math.round(raw * 10) / 10;
  if (!Number.isFinite(raw) || miles <= 0 || miles > MAX_TRIP_MILES) {
    return { ok: false, error: "Enter the miles driven, there and back." };
  }
  const purpose = typeof b.purpose === "string" ? b.purpose.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  if (!purpose) return { ok: false, error: "Say what the trip was for — the IRS wants a reason for every one." };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
  return { ok: true, value: { date, miles, purpose, note } };
}

/** "76¢", "72.5¢" */
export function centsLabel(cents: number): string {
  return `${Number.isInteger(cents) ? cents : cents.toFixed(1)}¢`;
}
