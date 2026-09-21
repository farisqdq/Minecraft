/**
 * Lease arithmetic shared by the dashboard and the property page, so "6 days
 * late" and "lease ends in 3 weeks" mean the same thing in both places.
 */

export type LeaseLike = {
  dueDay: number;
  leaseStart: string;
  leaseEnd: string;
  active: boolean;
};

const MS_PER_DAY = 86_400_000;

/** Midnight today, in the viewer's own timezone — rent is late by local days. */
export function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseISODay(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A YYYY-MM-DD string as a local midnight Date. Pages that render "how many
 * days late" hand this in as `now`, so the server's clock and the browser's
 * clock can be reconciled explicitly instead of disagreeing across a
 * hydration boundary.
 */
export function dateFromISO(iso: string) {
  return parseISODay(iso) ?? today();
}

export function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * The date rent was due in a given YYYY-MM. A due day past the end of a short
 * month lands on its last day — the 31st in February means "end of February",
 * not a date that doesn't exist.
 */
export function dueDateFor(month: string, dueDay: number) {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return new Date(y, m - 1, Math.min(Math.max(dueDay, 1), lastDay));
}

/**
 * How many days past due an unpaid month is. Zero or negative means it isn't
 * late yet, so callers can treat `> 0` as "chase this".
 */
export function daysLate(month: string, dueDay: number, now = today()) {
  return daysBetween(dueDateFor(month, dueDay), now);
}

/** Days until a lease ends; null when there's no end date on file. */
export function daysUntilLeaseEnd(leaseEnd: string, now = today()) {
  const end = parseISODay(leaseEnd);
  return end ? daysBetween(now, end) : null;
}

/** Leases worth flagging: ending within 60 days, or already run out. */
export const LEASE_WARNING_DAYS = 60;

export function leaseStatus(tenant: LeaseLike, now = today()) {
  if (!tenant.active) return { kind: "past" as const, label: "Past", days: null };
  const days = daysUntilLeaseEnd(tenant.leaseEnd, now);
  if (days === null) return { kind: "ok" as const, label: "Current", days: null };
  // Kept short: these sit in a pill beside a name, and the row or card around
  // them already says it's a lease.
  if (days < 0) return { kind: "expired" as const, label: "Lease ended", days };
  if (days === 0) return { kind: "ending" as const, label: "Ends today", days };
  if (days <= LEASE_WARNING_DAYS) {
    return {
      kind: "ending" as const,
      label: days === 1 ? "Ends tomorrow" : `Ends in ${days} days`,
      days,
    };
  }
  return { kind: "ok" as const, label: "Current", days };
}

/** "Sep 1, 2026", or an em dash when the date is blank. */
export function formatDay(iso: string) {
  const d = parseISODay(iso);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

/** "Feb 1, 2023 – Jan 31, 2025", or whichever half is on file. */
export function leaseRange(leaseStart: string, leaseEnd: string) {
  const start = parseISODay(leaseStart);
  const end = parseISODay(leaseEnd);
  if (start && end) return `${formatDay(leaseStart)} – ${formatDay(leaseEnd)}`;
  if (start) return `From ${formatDay(leaseStart)}`;
  if (end) return `Until ${formatDay(leaseEnd)}`;
  return "Not recorded";
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** A phone number reduced to what a tel: link accepts. */
export function telHref(phone: string) {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

export function smsHref(phone: string) {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned ? `sms:${cleaned}` : "";
}
