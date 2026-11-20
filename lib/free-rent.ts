/**
 * Free months of rent (a35): a month's rent given to the tenant rather than
 * paid. Stored as a "free month" credit on their statement (see the schema's
 * TenantCharge.freeRent), which squares the month for statements, late fees,
 * reminders and the portal. The dashboards don't read statements — they total
 * rent from the ledger — so they add free months into those totals here.
 * Only the "is this month covered?" totals: money-received figures, cash flow,
 * taxes and returns never see a free month, because no money came in.
 *
 * Pure, for the tests.
 */

export type FreeRentMonth = {
  tenantId: string;
  propertyId: string;
  unitId: string | null;
  /** YYYY-MM */
  month: string;
  amount: number;
};

/** The line it shows as on the tenant's statement. */
export function freeRentLabel(reason: string): string {
  const r = reason.trim();
  return r ? `Free month — ${r}`.slice(0, 120) : "Free month";
}

/**
 * Adds free months into a rent index keyed "propertyId|unitId|YYYY-MM" (the
 * key every layout's index uses), so the month reads as covered. Returns a
 * new map; the ledger's own index is left as it was.
 */
export function withFreeRent(index: ReadonlyMap<string, number>, free: readonly FreeRentMonth[] | undefined): Map<string, number> {
  const out = new Map(index);
  for (const f of free ?? []) {
    const key = `${f.propertyId}|${f.unitId ?? ""}|${f.month}`;
    out.set(key, (out.get(key) ?? 0) + f.amount);
  }
  return out;
}

/** "tenantId|YYYY-MM" → true for each free month, for a card to say so. */
export function freeKeys(free: readonly FreeRentMonth[] | undefined): Record<string, true> {
  const out: Record<string, true> = {};
  for (const f of free ?? []) out[`${f.tenantId}|${f.month}`] = true;
  return out;
}

/** A free month with what the ledgers need to list it. */
export type FreeRentEntry = FreeRentMonth & {
  id: string;
  tenantName: string;
  /** The day it was given, YYYY-MM-DD. */
  given: string;
  /** Its statement line, "Free month" or "Free month — <reason>". */
  label: string;
};

/**
 * The free months a dashboard ledger should list next to its entries, newest
 * first. They're filed under the month they cover, like rent that "counts
 * toward" a month, and follow the ledger's own filters: the period on screen
 * (`scope` "YYYY-MM", "YYYY", or "" for all time) unless searching, which,
 * like the ledgers, looks across all time; the property and type filters (a
 * free month is rent); and the search box, against the tenant, the place,
 * the reason and the amount.
 */
export function freeRentInLedger(
  free: readonly FreeRentMonth[] | undefined,
  opts: {
    scope: string;
    /** Properties in view (the LLC picker); omitted means all. */
    propertyIds?: ReadonlySet<string>;
    propertyId?: string;
    type?: string;
    search?: string;
    place?: (f: FreeRentEntry) => string;
  }
): FreeRentEntry[] {
  if (opts.type && opts.type !== "rent") return [];
  const search = (opts.search ?? "").trim().toLowerCase();
  return (free ?? [])
    .filter((f): f is FreeRentEntry => typeof (f as FreeRentEntry).id === "string")
    .filter((f) => !opts.propertyIds || opts.propertyIds.has(f.propertyId))
    .filter((f) => !opts.propertyId || f.propertyId === opts.propertyId)
    .filter((f) => search || f.month.startsWith(opts.scope))
    .filter(
      (f) =>
        !search ||
        [f.tenantName, f.label, opts.place?.(f) ?? "", f.amount.toFixed(2)].join(" ").toLowerCase().includes(search)
    )
    .sort((a, b) => b.given.localeCompare(a.given) || b.month.localeCompare(a.month) || a.id.localeCompare(b.id));
}

/** The reason typed with a free month, or "" (its label minus "Free month — "). */
export function freeRentReason(label: string): string {
  return label === "Free month" ? "" : label.replace(/^Free month — /, "");
}
