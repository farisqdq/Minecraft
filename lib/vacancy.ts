/**
 * How long a place has stood empty, and what that has cost.
 *
 * A vacancy is the most expensive thing on a rent roll and the least visible:
 * it never appears in the ledger, because nothing happens. A late tenant
 * shows up as a red number every day; an empty unit shows up as nothing at
 * all, month after month. So the cost is worked out — the rent the place was
 * asking, by the day, from the day rent stopped coming in — and put where the
 * late rent is.
 *
 * Pure: no database and no clock. Days are YYYY-MM-DD strings in UTC.
 */

const DAY = 86_400_000;

const utc = (day: string) => new Date(`${day}T00:00:00Z`).getTime();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole days from `since` to `today`; zero if it hasn't started yet. */
export function vacantDays(since: string, today: string): number {
  return Math.max(0, Math.round((utc(today) - utc(since)) / DAY));
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Rent not collected from `since` up to (not including) `today`, at the
 * rent the place was asking in each month, prorated by the day. A month's
 * rent spread over its own days, so 10 empty days of a 30-day $1,500 month
 * is $500 and 10 of February's are a little more.
 */
export function vacancyCost(since: string, today: string, rentFor: (month: string) => number): number {
  let cents = 0;
  let cursor = utc(since);
  const end = utc(today);
  // Month by month rather than day by day: a vacancy can run for years.
  for (let guard = 0; cursor < end && guard < 1200; guard++) {
    const day = iso(cursor);
    const month = day.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const nextMonth = Date.UTC(y, m, 1);
    const segmentEnd = Math.min(end, nextMonth);
    const days = Math.round((segmentEnd - cursor) / DAY);
    cents += Math.round((rentFor(month) * 100 * days) / daysInMonth(month));
    cursor = segmentEnd;
  }
  return cents / 100;
}

/**
 * When a move-out leaves a place empty, the loss starts when rent stops —
 * the later of the day they left and the first day after the last month they
 * were charged for. Someone who leaves on the 26th having paid the month
 * hasn't cost anything yet; counting those days would charge the vacancy for
 * rent that was paid.
 */
export function vacancyStart(movedOutOn: string, lastRentMonth: string): string {
  const [y, m] = lastRentMonth.split("-").map(Number);
  const afterRent = iso(Date.UTC(y, m, 1));
  return afterRent > movedOutOn ? afterRent : movedOutOn;
}

/** "3 days", "6 weeks", "4 months" — how long, at the precision anyone thinks in. */
export function vacantFor(days: number): string {
  if (days < 1) return "from today";
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${Math.floor(days / 365.25)} years`;
}
