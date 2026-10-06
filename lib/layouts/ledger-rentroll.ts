/**
 * The Ledger layout's month: one row per rent target, grouped by LLC, with
 * the same figures the Classic overview shows for the same month.
 *
 * Every rule here is the Classic dashboard's (app/dashboard/DashboardClient):
 * the same rent targets (a house, each unit, and a "whole building" place on
 * a property with units), the same expected rent (rent history via
 * rentForMonth), the same paid figure (single-unit properties count rent on
 * the property toward the unit, lib/rent-target), the same tenant lookup, the
 * same "collected" (each target capped at what it owes) and the same "owed"
 * test (rent plus the month's late fees). Kept pure so tests can pin the two
 * dashboards to the same numbers.
 */

import { rentForMonth, type RentChangeDTO } from "../rent.ts";
import { rentTargetOf, unitIdsCountingToward } from "../rent-target.ts";
import { daysLate, leaseStatus } from "../lease.ts";

export type LedgerProperty = {
  id: string;
  companyId: string;
  name: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};

export type LedgerUnit = {
  id: string;
  propertyId: string;
  name: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};

export type LedgerTxn = {
  propertyId: string;
  unitId: string | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
  recurringExpenseId?: string | null;
};

export type LedgerTenant = {
  id: string;
  propertyId: string;
  unitId: string | null;
  name: string;
  dueDay: number;
  leaseStart: string;
  leaseEnd: string;
  active: boolean;
};

/** A place rent is logged against — the record sheet's targets, too. */
export type RentTarget = {
  key: string;
  propertyId: string;
  unitId: string | null;
  label: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
  /** The "(whole building)" place on a property with units: never a table row. */
  whole: boolean;
};

/** Every rent target, in property order — exactly Classic's visibleTargets. */
export function buildTargets(properties: LedgerProperty[], units: LedgerUnit[]): RentTarget[] {
  return properties.flatMap((p): RentTarget[] => {
    const propUnits = units.filter((u) => u.propertyId === p.id);
    if (propUnits.length === 0) {
      return [
        {
          key: p.id,
          propertyId: p.id,
          unitId: null,
          label: p.name,
          monthlyRent: p.monthlyRent,
          vacant: p.vacant,
          vacantSince: p.vacantSince,
          whole: false,
        },
      ];
    }
    return [
      ...propUnits.map((u) => ({
        key: `${p.id}:${u.id}`,
        propertyId: p.id,
        unitId: u.id,
        label: `${p.name} — ${u.name}`,
        monthlyRent: u.monthlyRent,
        vacant: u.vacant,
        vacantSince: u.vacantSince,
        whole: false,
      })),
      {
        key: `${p.id}:whole`,
        propertyId: p.id,
        unitId: null,
        label: `${p.name} — (whole building)`,
        monthlyRent: 0,
        vacant: false,
        vacantSince: null,
        whole: true,
      },
    ];
  });
}

/** Rent logged per "propertyId|unitId|YYYY-MM", summed in ledger order. */
export function rentIndex(txns: LedgerTxn[]): Map<string, number> {
  const rent = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "rent") continue;
    const key = `${t.propertyId}|${t.unitId ?? ""}|${t.date.slice(0, 7)}`;
    rent.set(key, (rent.get(key) ?? 0) + t.amount);
  }
  return rent;
}

/** Rent received toward one target in a month. */
export function rentPaid(
  index: Map<string, number>,
  units: LedgerUnit[],
  propertyId: string,
  unitId: string | null,
  month: string
): number {
  const propUnits = units.filter((u) => u.propertyId === propertyId);
  return unitIdsCountingToward(unitId, propUnits).reduce(
    (sum, u) => sum + (index.get(`${propertyId}|${u ?? ""}|${month}`) ?? 0),
    0
  );
}

/** The target's current tenant, when one is on file. */
export function tenantOf<T extends LedgerTenant>(
  tenants: T[],
  units: LedgerUnit[],
  propertyId: string,
  unitId: string | null
): T | null {
  const propUnits = units.filter((u) => u.propertyId === propertyId);
  const target = rentTargetOf(unitId, propUnits);
  return (
    tenants.find(
      (t) => t.active && t.propertyId === propertyId && rentTargetOf(t.unitId ?? null, propUnits) === target
    ) ?? null
  );
}

export function expectedRent(changes: RentChangeDTO[], target: RentTarget, month: string): number {
  return rentForMonth(changes, target.propertyId, target.unitId, month, target.monthlyRent);
}

/**
 * Paid, Partial, Late, Due (owed, not late yet), Vacant, Lease ended (paid
 * up but the lease has run out), or No rent (nothing set for the month).
 */
export type RowStatus = "paid" | "partial" | "late" | "due" | "vacant" | "ended" | "norent";

export type RentRow<T extends LedgerTenant = LedgerTenant> = {
  target: RentTarget;
  companyId: string;
  tenant: T | null;
  /** Rent expected for the month. */
  due: number;
  /** Rent received toward it. */
  paid: number;
  /** Late fees on the books for the month. */
  fees: number;
  /** What is still owed: rent plus fees, less what came in; never negative. */
  balance: number;
  /** Days past the due date, when owed; 0 otherwise. */
  late: number;
  status: RowStatus;
  /** The tenant's lease: "ok", "ending" (within 60 days) or "expired". */
  lease: "ok" | "ending" | "expired" | "none";
  leaseLabel: string;
};

const EPS = 0.005;

/** One row per rentable place for the month (whole-building places only when rent is due on them). */
export function rentRollRows<T extends LedgerTenant>(o: {
  properties: LedgerProperty[];
  units: LedgerUnit[];
  tenants: T[];
  transactions: LedgerTxn[];
  rentChanges: RentChangeDTO[];
  lateFees: Record<string, number>;
  month: string;
  now: Date;
  index?: Map<string, number>;
}): RentRow<T>[] {
  const index = o.index ?? rentIndex(o.transactions);
  const companyOf = new Map(o.properties.map((p) => [p.id, p.companyId]));
  const rows: RentRow<T>[] = [];
  for (const target of buildTargets(o.properties, o.units)) {
    const due = expectedRent(o.rentChanges, target, o.month);
    if (target.whole && due <= 0) continue;
    const paid = rentPaid(index, o.units, target.propertyId, target.unitId, o.month);
    const tenant = tenantOf(o.tenants, o.units, target.propertyId, target.unitId);
    const fees = tenant ? o.lateFees[`${tenant.id}|${o.month}`] ?? 0 : 0;
    const ls = tenant ? leaseStatus(tenant, o.now) : null;
    const lease: RentRow["lease"] =
      !ls ? "none" : ls.kind === "expired" ? "expired" : ls.kind === "ending" ? "ending" : "ok";
    const owed = !target.vacant && due > 0 && paid < due + fees - EPS;
    const late = owed && tenant ? Math.max(0, daysLate(o.month, tenant.dueDay, o.now)) : 0;
    let status: RowStatus;
    if (target.vacant) status = "vacant";
    else if (due <= 0) status = "norent";
    else if (owed) status = late > 0 ? "late" : paid > EPS ? "partial" : "due";
    else status = lease === "expired" ? "ended" : "paid";
    rows.push({
      target,
      companyId: companyOf.get(target.propertyId) ?? "",
      tenant,
      due,
      paid,
      fees,
      balance: owed ? Math.max(0, due + fees - paid) : 0,
      late,
      status,
      lease,
      leaseLabel: ls?.label ?? "",
    });
  }
  return rows;
}

/**
 * The month's rent roll the way Classic's progress bar counts it: vacant and
 * rent-free places left out, each place's payment capped at what it owes.
 */
export function collectionOf(rows: RentRow[]) {
  let expected = 0;
  let collected = 0;
  let paidCount = 0;
  let dueCount = 0;
  for (const r of rows) {
    if (r.target.vacant || r.due <= 0) continue;
    expected += r.due;
    collected += Math.min(r.paid, r.due);
    dueCount += 1;
    if (r.paid >= r.due) paidCount += 1;
  }
  return { expected, collected, paidCount, dueCount, outstanding: Math.max(0, expected - collected) };
}

/** Rent in, expenses out and net for one month (or year, or "" for all time) prefix. */
export function periodTotals(txns: LedgerTxn[], prefix: string, propertyIds?: Set<string>) {
  let rent = 0;
  let expense = 0;
  for (const t of txns) {
    if (propertyIds && !propertyIds.has(t.propertyId)) continue;
    if (prefix && !t.date.startsWith(prefix)) continue;
    if (t.type === "rent") rent += t.amount;
    else expense += t.amount;
  }
  return { rent, expense, net: rent - expense };
}

export type RowFilter = "all" | "late" | "vacant" | "paid" | "review";

/** Rows that need a look: owed (late, partial or due), vacant, or a lease running out. */
export function needsReview(r: RentRow): boolean {
  return (
    r.status === "late" ||
    r.status === "partial" ||
    r.status === "due" ||
    r.status === "vacant" ||
    r.lease === "ending" ||
    r.lease === "expired"
  );
}

export function matchesFilter(r: RentRow, f: RowFilter): boolean {
  switch (f) {
    case "late":
      return r.status === "late";
    case "vacant":
      return r.status === "vacant";
    case "paid":
      return r.status === "paid" || r.status === "ended";
    case "review":
      return needsReview(r);
    default:
      return true;
  }
}

/** The counts on the filter pills and in the alert strip. */
export function rowCounts(rows: RentRow[]) {
  const c = { all: rows.length, late: 0, owed: 0, vacant: 0, paid: 0, leases: 0, review: 0 };
  for (const r of rows) {
    if (r.status === "late") c.late += 1;
    if (r.status === "partial" || r.status === "due") c.owed += 1;
    if (r.status === "vacant") c.vacant += 1;
    if (r.status === "paid" || r.status === "ended") c.paid += 1;
    if (r.lease === "ending" || r.lease === "expired") c.leases += 1;
    if (needsReview(r)) c.review += 1;
  }
  return c;
}

/** Rows grouped by LLC, in the order the LLCs are given, each with its own collected-of-due. */
export function groupByCompany<R extends RentRow>(rows: R[], companies: { id: string; name: string }[]) {
  return companies
    .map((c) => {
      const mine = rows.filter((r) => r.companyId === c.id);
      return { company: c, rows: mine, ...collectionOf(mine) };
    })
    .filter((g) => g.rows.length > 0);
}

/** Steps a YYYY-MM key by whole months. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every month from the earliest entry through `thisMonth` — Classic's month list. */
export function monthRange(txns: { date: string }[], thisMonth: string): string[] {
  const earliest = txns.reduce((min, t) => (t.date < min ? t.date : min), `${thisMonth}-01`).slice(0, 7);
  const list: string[] = [];
  for (let m = earliest; m <= thisMonth; m = shiftMonth(m, 1)) list.push(m);
  return list;
}

/** Share of rentable places (not the whole-building entries) with someone in them. */
export function occupancy(properties: LedgerProperty[], units: LedgerUnit[]) {
  const places = buildTargets(properties, units).filter((t) => !t.whole);
  const occupied = places.filter((t) => !t.vacant).length;
  return { occupied, total: places.length, pct: places.length ? Math.round((occupied / places.length) * 100) : 0 };
}
