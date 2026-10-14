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
