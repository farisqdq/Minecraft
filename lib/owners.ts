/**
 * The owner portal's arithmetic and rules, free of any database or clock so
 * they can be tested on their own. lib/owners-db.ts does the fetching.
 *
 * An owner here is a property owner or investor who is NOT on the
 * landlord's team — someone who put money into a house and wants to see
 * how it's doing. (The landlord-side "owner" role on CompanyMember is a
 * different thing; in code this one is always PropertyOwner.) They read,
 * they never write, and what they may read about a tenant is decided in
 * one place: `occupantForOwner`.
 *
 * Relative imports only: the test runner doesn't know the bundler's alias.
 */
import { randomBytes } from "crypto";
import { hashToken } from "./password-reset.ts";
import { money } from "./money.ts";
import { monthName } from "./notices.ts";
import { vacantDays, vacantFor } from "./vacancy.ts";

/* ---------- Invites ---------- */

/** How long an invite link works. Two weeks: long enough to get to it, short enough to lapse if it never is. */
export const OWNER_INVITE_DAYS = 14;

export function ownerInviteExpiry(from = new Date()) {
  return new Date(from.getTime() + OWNER_INVITE_DAYS * 24 * 60 * 60 * 1000);
}

/** A fresh token for the link and the hash the database keeps, like a password reset. */
export function newOwnerInviteToken(now = new Date()): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token), expiresAt: ownerInviteExpiry(now) };
}

export function ownerAcceptLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/owners/accept?token=${token}`;
}

/** Live means unaccepted and not yet expired. */
export function ownerInviteIsLive(row: { acceptedAt: Date | null; expiresAt: Date }, now = new Date()): boolean {
  return !row.acceptedAt && row.expiresAt.getTime() > now.getTime();
}

/** The invite's property list is stored as a JSON string; anything else reads as no properties. */
export function parsePropertyIds(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

export function serializePropertyIds(ids: string[]): string {
  return JSON.stringify(Array.from(new Set(ids)));
}

/**
 * Which of the requested property ids may go on an invite or an
 * assignment: only ones in the company, each once, in the company's order.
 * A request naming a property from another LLC gets it dropped, not an
 * error — there is nothing a legitimate form can do to send one.
 */
export function assignableIds(requested: unknown, companyPropertyIds: string[]): string[] {
  const wanted = new Set(Array.isArray(requested) ? requested.filter((x): x is string => typeof x === "string") : []);
  return companyPropertyIds.filter((id) => wanted.has(id));
}

export function ownerInviteEmail(opts: {
  link: string;
  companyName: string;
  propertyNames: string[];
  siteName?: string;
}): { subject: string; text: string } {
  const site = opts.siteName ?? "Rent Roll";
  const list = opts.propertyNames.map((n) => `  - ${n}`).join("\n");
  return {
    subject: `${opts.companyName} has shared ${opts.propertyNames.length === 1 ? "a property" : "properties"} with you on ${site}`,
    text: [
      `${opts.companyName} has given you owner access on ${site} to:`,
      "",
      list,
      "",
      `You'll be able to see the rent roll, income and expenses, monthly statements, open repairs and shared documents for ${
        opts.propertyNames.length === 1 ? "this property" : "these properties"
      } — read-only.`,
      "",
      `Set up your login here (the link works once, for ${OWNER_INVITE_DAYS} days):`,
      opts.link,
      "",
      "If you weren't expecting this, you can ignore it.",
    ].join("\n"),
  };
}

/* ---------- Scoping ---------- */

/** The property ids an owner may read, from their access rows. */
export function scopedPropertyIds(access: { propertyId: string }[]): string[] {
  return Array.from(new Set(access.map((a) => a.propertyId)));
}

export function ownerMaySeeProperty(ownerPropertyIds: string[], propertyId: string): boolean {
  return ownerPropertyIds.includes(propertyId);
}

/**
 * Whether an owner may read a document: it must be filed against one of
 * their properties AND switched on for owners. An LLC-level document (no
 * property) is never theirs, and a tenant's shared lease isn't either
 * unless the landlord also turned this on.
 */
export function ownerMayViewDocument(
  doc: { propertyId: string | null; sharedWithOwners: boolean },
  ownerPropertyIds: string[]
): boolean {
  return doc.sharedWithOwners && doc.propertyId !== null && ownerPropertyIds.includes(doc.propertyId);
}

/* ---------- Tenant privacy ---------- */

/** "Maria" from "Maria Gonzalez-Ruiz"; "" from nothing. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export type Occupant = {
  /** A first name, or "Occupied" when there isn't one. Never a surname. */
  label: string;
  /** YYYY-MM the lease ends, or "" when open-ended or not recorded. */
  leaseEndMonth: string;
};

/**
 * Everything an owner may know about who lives in a unit, in one place.
 *
 * The owner gets the first name and the month the lease ends. Not the
 * email, phone, deposit, balance, notes, due day or exact dates: a tenant's
 * relationship is with the landlord, and an investor who can see that
 * Maria is late is an investor who might ring Maria. Anything not returned
 * here does not reach the portal, because the portal only ever renders
 * what this returns.
 */
export function occupantForOwner(tenant: { name: string; leaseEnd: Date | string | null }): Occupant {
  const first = firstName(tenant.name);
  const end = tenant.leaseEnd
    ? typeof tenant.leaseEnd === "string"
      ? tenant.leaseEnd.slice(0, 7)
      : tenant.leaseEnd.toISOString().slice(0, 7)
    : "";
  return { label: first || "Occupied", leaseEndMonth: /^\d{4}-\d{2}$/.test(end) ? end : "" };
}

/* ---------- Rent roll ---------- */

export type RentRollRow = {
  propertyId: string;
  unitId: string | null;
  /** "Apt 2", or the property name when it has no units. */
  label: string;
  monthlyRent: number;
  vacant: boolean;
  /** YYYY-MM-DD, when known. */
  vacantSince: string;
  occupant: Occupant | null;
};

type PlaceLike = { id: string; name: string; monthlyRent: number; vacant: boolean; vacantSince: Date | string | null };
type TenantLike = { propertyId: string; unitId: string | null; name: string; leaseEnd: Date | string | null; active: boolean };

const dayOf = (d: Date | string | null) => (d ? (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : "");

/**
 * One row per rentable place: each unit of a property that has units,
 * otherwise the property itself. A place is vacant when it says so or when
 * nobody active lives there — the two can disagree for a day after a
 * move-out, and an empty place read as full is the worse mistake for an
 * owner counting on the rent.
 */
export function rentRollFor(
  property: PlaceLike,
  units: PlaceLike[],
  tenants: TenantLike[]
): RentRollRow[] {
  const places: { unitId: string | null; place: PlaceLike }[] =
    units.length > 0 ? units.map((u) => ({ unitId: u.id, place: u })) : [{ unitId: null, place: property }];
  return places.map(({ unitId, place }) => {
    const tenant = tenants.find((t) => t.active && t.propertyId === property.id && (t.unitId ?? null) === unitId) ?? null;
    const vacant = place.vacant || !tenant;
    return {
      propertyId: property.id,
      unitId,
      label: unitId ? place.name : property.name,
      monthlyRent: place.monthlyRent,
      vacant,
      vacantSince: vacant ? dayOf(place.vacantSince) : "",
      occupant: vacant ? null : occupantForOwner(tenant!),
    };
  });
}

/** "3 weeks", "4 months" — how long a place has stood empty, from a YYYY-MM-DD. */
export function vacantForLabel(since: string, now: Date): string {
  return vacantFor(vacantDays(since, now.toISOString().slice(0, 10)));
}

/** How full a set of rows is. */
export function occupancy(rows: RentRollRow[]): { total: number; occupied: number; vacant: number; scheduledRent: number } {
  const occupied = rows.filter((r) => !r.vacant).length;
  return {
    total: rows.length,
    occupied,
    vacant: rows.length - occupied,
    scheduledRent: rows.reduce((sum, r) => sum + (r.vacant ? 0 : r.monthlyRent), 0),
  };
}

/* ---------- Money ---------- */

export type OwnerTxn = {
  propertyId: string;
  /** "rent" | "expense", as in the ledger. */
  type: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  category: string;
  /**
   * Income that isn't rent: today that is deposit money kept at a
   * move-out, which the ledger records as a rent-type entry tied to the
   * move-out. The database layer sets this; the arithmetic only reads it.
   */
  otherIncome?: boolean;
};

export type MoneyKind = "rent" | "other" | "expense";

export function classify(t: OwnerTxn): MoneyKind {
  if (t.type === "expense") return "expense";
  return t.otherIncome ? "other" : "rent";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type MonthTotals = { month: string; rent: number; other: number; expense: number; net: number };

/** Steps a YYYY-MM by whole months. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** The `count` months ending at `endMonth`, oldest first. */
export function monthsEnding(endMonth: string, count = 12): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(endMonth, i - (count - 1)));
}

/** Rent, other income, expenses and net for each of the given months. */
export function monthSeries(txns: OwnerTxn[], months: string[]): MonthTotals[] {
  const buckets = new Map(months.map((m) => [m, { month: m, rent: 0, other: 0, expense: 0, net: 0 }]));
  for (const t of txns) {
    const b = buckets.get(t.date.slice(0, 7));
    if (!b) continue;
    b[classify(t)] += t.amount;
  }
  return months.map((m) => {
    const b = buckets.get(m)!;
    return { ...b, rent: round2(b.rent), other: round2(b.other), expense: round2(b.expense), net: round2(b.rent + b.other - b.expense) };
  });
}

/** Totals across every transaction dated inside `prefix` ("2026" or "2026-09"). */
export function totalsFor(txns: OwnerTxn[], prefix: string): Omit<MonthTotals, "month"> {
  let rent = 0;
  let other = 0;
  let expense = 0;
  for (const t of txns) {
    if (!t.date.startsWith(prefix)) continue;
    const kind = classify(t);
    if (kind === "rent") rent += t.amount;
    else if (kind === "other") other += t.amount;
    else expense += t.amount;
  }
  return { rent: round2(rent), other: round2(other), expense: round2(expense), net: round2(rent + other - expense) };
}

export type StatementLine = { category: string; amount: number };

export type OwnerStatement = {
  month: string;
  rentCollected: number;
  otherIncome: number;
  totalIncome: number;
  /** Largest first, so the thing that ate the month is at the top. */
  expenses: StatementLine[];
  totalExpenses: number;
  net: number;
  /** How many ledger entries went into it — zero means "nothing recorded", which is worth saying. */
  entries: number;
};

/** One month's statement for a set of transactions (already scoped to the properties in question). */
export function statementFor(txns: OwnerTxn[], month: string): OwnerStatement {
  let rent = 0;
  let other = 0;
  let entries = 0;
  const byCategory = new Map<string, number>();
  for (const t of txns) {
    if (t.date.slice(0, 7) !== month) continue;
    entries += 1;
    const kind = classify(t);
    if (kind === "rent") rent += t.amount;
    else if (kind === "other") other += t.amount;
    else {
      const key = t.category || "Other";
      byCategory.set(key, (byCategory.get(key) ?? 0) + t.amount);
    }
  }
  const expenses = Array.from(byCategory, ([category, amount]) => ({ category, amount: round2(amount) })).sort(
    (a, b) => b.amount - a.amount || a.category.localeCompare(b.category)
  );
  const totalExpenses = round2(expenses.reduce((s, e) => s + e.amount, 0));
  return {
    month,
    rentCollected: round2(rent),
    otherIncome: round2(other),
    totalIncome: round2(rent + other),
    expenses,
    totalExpenses,
    net: round2(rent + other - totalExpenses),
    entries,
  };
}

/** The same, added up across several statements (one per property) into one. */
export function combineStatements(parts: OwnerStatement[], month: string): OwnerStatement {
  const byCategory = new Map<string, number>();
  let rent = 0;
  let other = 0;
  let entries = 0;
  for (const p of parts) {
    rent += p.rentCollected;
    other += p.otherIncome;
    entries += p.entries;
    for (const e of p.expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  }
  const expenses = Array.from(byCategory, ([category, amount]) => ({ category, amount: round2(amount) })).sort(
    (a, b) => b.amount - a.amount || a.category.localeCompare(b.category)
  );
  const totalExpenses = round2(expenses.reduce((s, e) => s + e.amount, 0));
  return {
    month,
    rentCollected: round2(rent),
    otherIncome: round2(other),
    totalIncome: round2(rent + other),
    expenses,
    totalExpenses,
    net: round2(rent + other - totalExpenses),
    entries,
  };
}

/* ---------- The monthly email ---------- */

/**
 * Which month's statement is ready to send on a given day: the previous
 * month, once the 2nd has arrived — the 1st is when the last of the
 * month's rent is still being recorded. Null on the 1st. Days are judged in
 * UTC like the rest of the daily run.
 */
export function statementMonthDue(now: Date): string | null {
  if (now.getUTCDate() < 2) return null;
  return shiftMonth(monthKeyOf(now), -1);
}

/** The ReminderSent key that makes the monthly email go once per owner per month. */
export function ownerStatementKey(ownerId: string, month: string): string {
  return `owner-statement:${ownerId}:${month}`;
}

export function ownerStatementLink(origin: string, month: string): string {
  return `${origin.replace(/\/+$/, "")}/owners/statement?month=${month}`;
}

export function ownerStatementEmail(opts: {
  name: string;
  month: string;
  link: string;
  properties: { name: string; statement: OwnerStatement }[];
  combined: OwnerStatement;
  siteName?: string;
}): { subject: string; text: string } {
  const site = opts.siteName ?? "Rent Roll";
  const when = monthName(opts.month);
  const line = (s: OwnerStatement) =>
    `rent ${money(s.rentCollected)}${s.otherIncome ? `, other income ${money(s.otherIncome)}` : ""}, expenses ${money(
      s.totalExpenses
    )}, net ${s.net < 0 ? "-" : ""}${money(Math.abs(s.net))}`;
  const lines = opts.properties.map((p) => `  ${p.name}: ${line(p.statement)}`);
  return {
    subject: `Your ${when} owner statement is ready`,
    text: [
      `Hi ${firstName(opts.name) || "there"},`,
      "",
      `Your owner statement for ${when} is ready on ${site}.`,
      "",
      ...lines,
      ...(opts.properties.length > 1 ? [`  All together: ${line(opts.combined)}`] : []),
      "",
      "See the full statement, with expenses by category, and download it as a PDF:",
      opts.link,
      "",
      "You're getting this because you asked for a monthly email. Turn it off under Account on the portal.",
    ].join("\n"),
  };
}

/* ---------- Repairs ---------- */

export type OwnerRequest = {
  id: string;
  propertyId: string;
  propertyName: string;
  unitName: string;
  title: string;
  category: string;
  status: string;
  urgency: string;
  /** ISO timestamp */
  createdAt: string;
};

/**
 * A repair as an owner sees it: what's wrong, where, how far along. Not
 * who reported it, not what they wrote, not who's fixing it or for how
 * much. Built from named fields rather than spreading the row, so a column
 * added later can't leak by default.
 */
export function requestForOwner(r: {
  id: string;
  propertyId: string;
  title: string;
  category: string;
  status: string;
  urgency: string;
  createdAt: Date | string;
  property: { name: string };
  unit: { name: string } | null;
}): OwnerRequest {
  return {
    id: r.id,
    propertyId: r.propertyId,
    propertyName: r.property.name,
    unitName: r.unit?.name ?? "",
    title: r.title,
    category: r.category,
    status: r.status,
    urgency: r.urgency,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : r.createdAt.toISOString(),
  };
}

/** The owner-facing wording for a repair's status: the queue label, not the tenant's sentence. */
export const OWNER_STATUS_LABEL: Record<string, string> = {
  open: "New",
  seen: "Seen",
  scheduled: "Scheduled",
  done: "Done",
  declined: "Declined",
};
