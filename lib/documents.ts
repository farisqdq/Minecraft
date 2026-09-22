/**
 * Documents and when they run out. Pure — no database, no clock of its own.
 */

export const KINDS = [
  "Lease",
  "Insurance certificate",
  "Business licence",
  "Inspection",
  "Permit",
  "W-9",
  "Contract",
  "Other",
] as const;

export type DocKind = (typeof KINDS)[number];

export function normalizeKind(value: unknown): DocKind {
  if (typeof value !== "string") return "Other";
  const v = value.trim().toLowerCase();
  // "license" is how most people spell it here; the list uses the other one.
  const hit = KINDS.find((k) => k.toLowerCase() === v || k.toLowerCase() === v.replace("license", "licence"));
  return hit ?? "Other";
}

/**
 * How far ahead counts as "coming up". A month is long enough to chase a
 * tenant for a new insurance certificate and short enough not to cry wolf.
 */
export const SOON_DAYS = 30;

export type ExpiryState = "none" | "ok" | "soon" | "expired";

const DAY = 86_400_000;

/** Whole days from `today` to `expiresOn`, both taken as calendar days (UTC). */
export function daysUntil(expiresOn: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.parse(`${expiresOn}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / DAY);
}

/**
 * A document dated today is still good today — it expires at the end of the
 * day it names, which is how a certificate reading "valid through 9/30"
 * is meant.
 */
export function expiryState(expiresOn: string, today: string): ExpiryState {
  const d = daysUntil(expiresOn, today);
  if (d === null) return "none";
  if (d < 0) return "expired";
  if (d <= SOON_DAYS) return "soon";
  return "ok";
}

/** "Expired 3 days ago", "Expires today", "Expires in 12 days", "Good until Mar 1, 2027". */
export function expiryLabel(expiresOn: string, today: string, formatDay: (iso: string) => string): string {
  const d = daysUntil(expiresOn, today);
  if (d === null) return "No expiry";
  if (d < -1) return `Expired ${-d} days ago`;
  if (d === -1) return "Expired yesterday";
  if (d === 0) return "Expires today";
  if (d === 1) return "Expires tomorrow";
  if (d <= SOON_DAYS) return `Expires in ${d} days`;
  return `Good until ${formatDay(expiresOn)}`;
}

/** Most urgent first: expired, then soonest to run out, then everything else. */
export function byUrgency<T extends { expiresOn: string }>(docs: T[], today: string): T[] {
  const rank = (s: ExpiryState) => ({ expired: 0, soon: 1, ok: 2, none: 3 })[s];
  return [...docs].sort(
    (a, b) =>
      rank(expiryState(a.expiresOn, today)) - rank(expiryState(b.expiresOn, today)) ||
      (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999")
  );
}

export type DocumentDTO = {
  id: string;
  companyId: string;
  propertyId: string;
  tenantId: string;
  vendorId: string;
  /** What it's attached to, for a list that mixes them. */
  ownerLabel: string;
  title: string;
  kind: DocKind;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  expiresOn: string;
  note: string;
  shared: boolean;
  createdAt: string;
};
