/** Month and day labels for the Ledger layout, formatted the way the Classic overview does. */

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const MONTH_ONLY = new Intl.DateTimeFormat("en-US", { month: "long" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "September 2026" (or "September"). */
export function monthName(key: string, withYear = true): string {
  const [y, m] = key.split("-").map(Number);
  return (withYear ? MONTH_YEAR : MONTH_ONLY).format(new Date(y, m - 1, 1));
}

/** "Sep". */
export function shortMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return MONTH_SHORT.format(new Date(y, m - 1, 1));
}

/** "Sep 4, 2026" from YYYY-MM-DD. */
export function dayLabel(iso: string): string {
  return DAY.format(new Date(`${iso}T00:00:00`));
}
