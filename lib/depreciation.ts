/**
 * Depreciation: the deduction that never leaves the bank account.
 *
 * The IRS treats a rental building as wearing out on paper over 27.5 years
 * (39 for a commercial building such as a storefront), and lets the owner
 * deduct that wear every year on Schedule E line 18. For most small landlords
 * it's the largest single deduction they have — often the difference between
 * a taxable profit and a paper loss — and because no money moves, a ledger of
 * payments never shows it. Improvements that add to the building (a roof, a
 * furnace, a remodel) are depreciated the same way from when they're put in
 * service, rather than deducted in one year like a repair.
 *
 * This is the General Depreciation System's straight-line method with the
 * mid-month convention, which is what applies to both classes: a building
 * placed in service in any month is treated as placed in service halfway
 * through it. Land never depreciates, so the basis is the building's share
 * of the cost only.
 *
 * Pure: no database, no clock. Amounts in whole cents, and each year is the
 * difference between two rounded running totals, so the years always add up
 * to exactly the basis — never a cent over, which would be a deduction the
 * IRS didn't allow.
 */

export const ASSET_CLASSES = ["residential", "commercial"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const RECOVERY_YEARS: Record<AssetClass, number> = {
  residential: 27.5,
  commercial: 39,
};

export const CLASS_LABEL: Record<AssetClass, string> = {
  residential: "Residential rental · 27.5 years",
  commercial: "Commercial · 39 years",
};

export type Asset = {
  /** What was paid for the depreciable part, in dollars. */
  basis: number;
  /** YYYY-MM it was ready and available to rent. */
  inService: string;
  cls: AssetClass;
};

/** How much of the basis has been deducted by the end of `year`, in cents. */
function takenCents(a: Asset, year: number): number {
  const [y0, m] = a.inService.split("-").map(Number);
  if (!y0 || !m || year < y0) return 0;
  const basis = Math.round(a.basis * 100);
  // Months in service by the end of `year`, counting the first as half.
  const months = 12 - m + 0.5 + 12 * (year - y0);
  const fraction = months / (RECOVERY_YEARS[a.cls] * 12);
  return fraction >= 1 ? basis : Math.round(basis * fraction);
}

/** The deduction for one tax year. */
export function depreciationFor(a: Asset, year: number): number {
  return (takenCents(a, year) - takenCents(a, year - 1)) / 100;
}

/** Everything deducted through the end of `year` — what gets recaptured on a sale. */
export function accumulatedThrough(a: Asset, year: number): number {
  return takenCents(a, year) / 100;
}

/** The last tax year with a deduction in it. */
export function finalYear(a: Asset): number {
  const [y0, m] = a.inService.split("-").map(Number);
  const months = RECOVERY_YEARS[a.cls] * 12 - (12 - m + 0.5);
  return y0 + Math.ceil(months / 12);
}

export function normalizeClass(v: unknown): AssetClass {
  return v === "commercial" ? "commercial" : "residential";
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type AssetInput = {
  label: string;
  kind: "building" | "improvement";
  cls: AssetClass;
  basis: number;
  inService: string;
  note: string | null;
};

export function parseAssetInput(body: unknown): { ok: true; value: AssetInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind === "improvement" ? "improvement" : "building";
  const label =
    (typeof b.label === "string" ? b.label.trim().slice(0, 120) : "") || (kind === "building" ? "Building" : "");
  if (!label) return { ok: false, error: "Say what the improvement was, e.g. “New roof”." };
  const basis = typeof b.basis === "number" ? b.basis : Number(String(b.basis ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(basis) || basis <= 0 || basis > 100_000_000) {
    return { ok: false, error: "Enter what it cost — for a building, the purchase price less the land." };
  }
  const inService = typeof b.inService === "string" ? b.inService : "";
  if (!MONTH_RE.test(inService)) return { ok: false, error: "Pick the month it was first ready to rent." };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  return {
    ok: true,
    value: { label, kind, cls: normalizeClass(b.cls), basis: Math.round(basis * 100) / 100, inService, note },
  };
}
