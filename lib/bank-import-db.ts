/**
 * The database side of importing a bank statement: what the matcher needs
 * to know about one LLC, and writing the lines a person chose.
 *
 * The file itself never reaches the server. The browser reads it
 * (lib/bank-csv) and sends only date, amount and description per line, so a
 * statement full of unrelated personal spending is never stored — only the
 * lines someone decided to book.
 */

import { prisma } from "./prisma";
import { normalizeCategory } from "./categories";
import { validAmount } from "./money";
import { REF_PATTERN } from "./bank-csv";
import { suggestAll, type ImportRow, type MatchContext, type Suggestion } from "./bank-match";

/** One upload's worth. A year of a busy account is well under this. */
export const MAX_IMPORT_ROWS = 3000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Statement lines from a request body, or an error to show. */
export function parseRows(raw: unknown): { ok: true; rows: ImportRow[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "No lines to look at." };
  if (raw.length > MAX_IMPORT_ROWS) return { ok: false, error: `At most ${MAX_IMPORT_ROWS} lines at a time — export a shorter date range.` };
  const rows: ImportRow[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const amount = Number(o.amount);
    if (typeof o.ref !== "string" || !REF_PATTERN.test(o.ref) || !validDay(o.date) || !validAmount(Math.abs(amount))) {
      return { ok: false, error: "Some lines couldn't be read. Upload the file again." };
    }
    rows.push({ ref: o.ref, date: o.date, amount: Math.round(amount * 100) / 100, text: str(o.text, 300) });
  }
  return { ok: true, rows };
}

function shiftDay(iso: string, days: number): Date {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000);
}

/** Everything the matcher reads, for one LLC and the dates the statement covers. */
export async function matchContext(companyId: string, rows: ImportRow[]): Promise<MatchContext> {
  const dates = rows.map((r) => r.date).sort();
  const from = shiftDay(dates[0], -10);
  const to = shiftDay(dates[dates.length - 1], 10);
  const inCompany = { property: { companyId } };

  const [properties, units, rentChanges, tenants, ledger, learned, vendors, recurring, loans] = await Promise.all([
    prisma.property.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
    prisma.unit.findMany({ where: inCompany, orderBy: { createdAt: "asc" } }),
    prisma.rentChange.findMany({ where: inCompany }),
    prisma.tenant.findMany({ where: { ...inCompany, active: true } }),
    prisma.transaction.findMany({
      where: { ...inCompany, date: { gte: from, lte: to } },
      select: {
        id: true, type: true, date: true, amount: true, propertyId: true, unitId: true, detail: true,
        category: true, vendorId: true, recurringExpenseId: true, bankRef: true,
      },
    }),
    // What earlier imports were filed as. The newest few thousand are
    // plenty to remember every payee an LLC deals with.
    prisma.transaction.findMany({
      where: { ...inCompany, bankText: { not: null } },
      orderBy: { date: "desc" },
      take: 5000,
      select: { bankText: true, type: true, date: true, amount: true, propertyId: true, unitId: true, category: true, detail: true, vendorId: true },
    }),
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.recurringExpense.findMany({ where: inCompany }),
    prisma.loan.findMany({ where: { ...inCompany, active: true } }),
  ]);

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const unitsOf = (propertyId: string) => units.filter((u) => u.propertyId === propertyId);
  const places = properties.flatMap((p): MatchContext["places"] => {
    const own = unitsOf(p.id);
    if (own.length === 0) return [{ propertyId: p.id, unitId: null, label: p.name, rent: p.monthlyRent, vacant: p.vacant }];
    return [
      ...own.map((u) => ({ propertyId: p.id, unitId: u.id, label: `${p.name} — ${u.name}`, rent: u.monthlyRent, vacant: u.vacant })),
      // Rent paid for the whole building is allowed, but has no rent of its own to match.
      { propertyId: p.id, unitId: null, label: `${p.name} — (whole building)`, rent: 0, vacant: false },
    ];
  });

  return {
    properties: properties.map((p) => ({ id: p.id, name: p.name })),
    places,
    rentChanges: rentChanges.map((c) => ({
      id: c.id,
      propertyId: c.propertyId,
      unitId: c.unitId,
      effectiveFrom: c.effectiveFrom.toISOString().slice(0, 7),
      amount: c.amount,
    })),
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      propertyId: t.propertyId,
      unitId: t.unitId,
      deposit: t.deposit,
      leaseStart: t.leaseStart ? day(t.leaseStart) : "",
    })),
    ledger: ledger.map((t) => ({
      id: t.id,
      type: t.type === "expense" ? "expense" : "rent",
      date: day(t.date),
      amount: t.amount,
      propertyId: t.propertyId,
      unitId: t.unitId,
      detail: t.detail ?? "",
      category: t.category ?? "",
      vendorId: t.vendorId,
      recurringExpenseId: t.recurringExpenseId,
      bankRef: t.bankRef,
    })),
    learned: learned.map((t) => ({
      bankText: t.bankText ?? "",
      type: t.type === "expense" ? "expense" : "rent",
      date: day(t.date),
      amount: t.amount,
      propertyId: t.propertyId,
      unitId: t.unitId,
      category: t.category ?? "",
      detail: t.detail ?? "",
      vendorId: t.vendorId,
    })),
    vendors,
    recurring: recurring.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      unitId: r.unitId,
      category: r.category,
      detail: r.detail ?? "",
      amount: r.amount,
      frequency: r.frequency === "yearly" ? "yearly" : "monthly",
      month: r.month,
      active: r.active,
    })),
    loans: loans.map((l) => ({
      id: l.id,
      propertyId: l.propertyId,
      lender: l.lender,
      payment: l.payment,
      escrow: Math.round((l.escrowTax + l.escrowInsurance) * 100) / 100,
      active: l.active,
    })),
  };
}

export async function suggestionsFor(companyId: string, rows: ImportRow[]): Promise<Suggestion[]> {
  return suggestAll(rows, await matchContext(companyId, rows));
}

/** A line someone chose to book, as the client sends it. */
export type ImportChoice = {
  ref: string;
  date: string;
  /** Positive; the type says which way it went. */
  amount: number;
  type: "rent" | "expense";
  propertyId: string;
  unitId: string | null;
  category: string | null;
  detail: string;
  note: string;
  vendorId: string | null;
  recurringExpenseId: string | null;
  bankText: string;
};

/**
 * Checks every chosen line against the LLC — each id must be one of its own
 * — and writes them in one go. A line whose ref is already on the books is
 * passed over rather than written again, so a double-click, a retry after a
 * dropped connection, or a second tab can't double anything.
 */
export async function importChoices(
  userId: string,
  companyId: string,
  raw: unknown
): Promise<{ ok: true; created: number; alreadyImported: number } | { ok: false; error: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Nothing chosen to import." };
  if (raw.length > MAX_IMPORT_ROWS) return { ok: false, error: `At most ${MAX_IMPORT_ROWS} lines at a time.` };

  const [properties, units, vendors, recurring] = await Promise.all([
    prisma.property.findMany({ where: { companyId }, select: { id: true } }),
    prisma.unit.findMany({ where: { property: { companyId } }, select: { id: true, propertyId: true } }),
    prisma.vendor.findMany({ where: { companyId }, select: { id: true } }),
    prisma.recurringExpense.findMany({ where: { property: { companyId } }, select: { id: true, propertyId: true } }),
  ]);
  const propertyIds = new Set(properties.map((p) => p.id));
  const unitProperty = new Map(units.map((u) => [u.id, u.propertyId]));
  const vendorIds = new Set(vendors.map((v) => v.id));
  const recurringProperty = new Map(recurring.map((r) => [r.id, r.propertyId]));

  const choices: ImportChoice[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const type = o.type === "expense" ? "expense" : o.type === "rent" ? "rent" : null;
    const amount = Number(o.amount);
    const propertyId = typeof o.propertyId === "string" ? o.propertyId : "";
    const unitId = typeof o.unitId === "string" && o.unitId ? o.unitId : null;
    const category = type === "expense" ? normalizeCategory(o.category) : null;
    if (typeof o.ref !== "string" || !REF_PATTERN.test(o.ref) || !validDay(o.date) || !type || !validAmount(amount)) {
      return { ok: false, error: "Some lines couldn't be read. Upload the file again." };
    }
    if (!propertyIds.has(propertyId)) return { ok: false, error: "A line points at a property that isn't in this LLC." };
    if (unitId && unitProperty.get(unitId) !== propertyId) {
      return { ok: false, error: "A line points at a unit that isn't in its property." };
    }
    if (type === "expense" && !category) return { ok: false, error: "Every expense needs a category." };
    const vendorId = typeof o.vendorId === "string" && vendorIds.has(o.vendorId) && type === "expense" ? o.vendorId : null;
    const recurringExpenseId =
      typeof o.recurringExpenseId === "string" && type === "expense" && recurringProperty.get(o.recurringExpenseId) === propertyId
        ? o.recurringExpenseId
        : null;
    if (seen.has(o.ref)) continue;
    seen.add(o.ref);
    choices.push({
      ref: o.ref,
      date: o.date,
      amount: Math.round(amount * 100) / 100,
      type,
      propertyId,
      unitId,
      category,
      detail: str(o.detail, 200),
      note: str(o.note, 500),
      vendorId,
      recurringExpenseId,
      bankText: str(o.bankText, 300),
    });
  }

  // Serializable, so two tabs importing the same lines at the same moment
  // can't both see them as new: one of the two is refused and retried, and
  // the retry finds the other's rows.
  const write = () =>
    prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findMany({
      where: { property: { companyId }, bankRef: { in: choices.map((c) => c.ref) } },
      select: { bankRef: true },
    });
    const done = new Set(existing.map((t) => t.bankRef));
    const fresh = choices.filter((c) => !done.has(c.ref));
    if (fresh.length > 0) {
      await tx.transaction.createMany({
        data: fresh.map((c) => ({
          propertyId: c.propertyId,
          unitId: c.unitId,
          createdById: userId,
          type: c.type,
          date: new Date(`${c.date}T00:00:00Z`),
          amount: c.amount,
          detail: c.detail || null,
          note: c.note || null,
          category: c.category,
          vendorId: c.vendorId,
          recurringExpenseId: c.recurringExpenseId,
          bankRef: c.ref,
          bankText: c.bankText || null,
        })),
      });
    }
    return { ok: true as const, created: fresh.length, alreadyImported: choices.length - fresh.length };
    }, { isolationLevel: "Serializable" });
  try {
    return await write();
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2034") throw e;
    return write();
  }
}
