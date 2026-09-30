/**
 * One badge for a property's month on the Properties list, built from the
 * same per-unit figures the dashboard card uses (rent for the month, rent
 * logged against it, the month's late fees, days past the tenant's due day),
 * so the list and the card never disagree about who has paid.
 *
 * Pure: no database, no clock. Relative imports only (tested with node).
 */

import { isPaidUp } from "./late-fee-card.ts";

export type PlaceMonth = {
  vacant: boolean;
  /** Rent for the month (after rent changes). */
  rent: number;
  /** Rent logged against it in the month. */
  paid: number;
  /** Late fees on the books for the month. */
  fees: number;
  /** Days past the tenant's due day; 0 or less is not late. No tenant → 0. */
  daysLate: number;
  /** A tenant is on it and their lease end date has passed. */
  leaseEnded: boolean;
};

/**
 * paid · partial · late · vacant · ended — the owner's five — plus "due"
 * (owed, nothing in yet, not past the due day: the dashboard's "Rent owed")
 * and "none" (let, but no rent set).
 */
export type PropertyStatus = "paid" | "partial" | "late" | "due" | "vacant" | "ended" | "none";

export function propertyStatus(places: readonly PlaceMonth[]): PropertyStatus {
  const occupied = places.filter((p) => !p.vacant);
  if (occupied.length === 0) return "vacant";

  const billed = occupied.filter((p) => p.rent > 0);
  const short = billed.filter((p) => !isPaidUp(p));
  // Money first: an overdue unit is the thing to act on, whatever else is true.
  if (short.some((p) => p.daysLate > 0)) return "late";
  const someIn = billed.some((p) => p.paid > 0);
  if (short.length > 0 && someIn) return "partial";

  // Everyone on it is past their lease end: worth seeing even when paid up.
  if (occupied.every((p) => p.leaseEnded)) return "ended";
  if (billed.length === 0) return "none";
  return short.length === 0 ? "paid" : "due";
}

/** Worst first, for sorting by status. */
export const STATUS_RANK: Record<PropertyStatus, number> = {
  late: 0,
  partial: 1,
  due: 2,
  ended: 3,
  paid: 4,
  none: 5,
  vacant: 6,
};
