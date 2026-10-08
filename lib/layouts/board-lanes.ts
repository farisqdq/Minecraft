/**
 * The Status Board's month: every rent target sorted into one lane — Late,
 * Due, Vacant, Lease ended or Paid — with the figures its card shows.
 *
 * The Classic dashboard works these numbers out inline (DashboardClient's
 * visibleTargets, unpaidThisMonth and collection). This is the same arithmetic
 * lifted out, so the board can be tested against it and the two layouts give
 * the same answer for the same month: a unit is owed when what came in is
 * short of rent plus that month's late fees, "collected" is capped per unit at
 * what it owes, and a tenant on the whole of a one-unit property rents that
 * unit (lib/rent-target.ts).
 *
 * Pure: no clock (today is handed in), no database, relative imports only.
 */

import { rentForMonth, type RentChangeDTO } from "../rent.ts";
import { allocate, spreadForReports } from "../spread.ts";
import { rentTargetOf, unitIdsCountingToward } from "../rent-target.ts";
import { dateFromISO, daysLate, leaseStatus } from "../lease.ts";
import { vacantDays } from "../vacancy.ts";

export type BoardProperty = {
  id: string;
  companyId: string;
  name: string;
  address: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};

export type BoardUnit = {
  id: string;
  propertyId: string;
  name: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};

export type BoardTenant = {
  id: string;
  propertyId: string;
  unitId: string | null;
  name: string;
  phone: string;
  dueDay: number;
  active: boolean;
  leaseStart: string;
  leaseEnd: string;
};

export type BoardTxn = {
  propertyId: string;
  unitId: string | null;
  appliesTo?: string | null;
  spreadMonths?: number | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
};

/** A place rent is logged against, keyed exactly as the record sheet keys it. */
export type BoardTarget = {
  key: string;
  propertyId: string;
  unitId: string | null;
  label: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
  /** The "(whole building)" option of a property with units. */
  whole: boolean;
};

export type Lane = "late" | "due" | "vacant" | "ended" | "paid";

export const LANES: Lane[] = ["late", "due", "vacant", "ended", "paid"];

export type LeaseState = ReturnType<typeof leaseStatus>;

export type BoardCard<T extends BoardTenant = BoardTenant> = {
  target: BoardTarget;
  property: BoardProperty;
  unitName: string | null;
  lane: Lane;
  tenant: T | null;
  lease: LeaseState | null;
  /** Rent for the month (at the rent it was that month). */
  expected: number;
  /** Rent logged for the month. */
  paid: number;
  /** Late fees on the books for the month. */
  fees: number;
  /** Still to come in: rent plus fees less paid, never negative. */
  owed: number;
  /** Days past the due date; 0 when not yet due. */
  lateDays: number;
  /** Something came in, but not everything. */
  partial: boolean;
  /** Share of rent + fees received, 0–100. */
  progress: number;
  /** Days empty, when the date it went empty is known. */
  vacantDays: number | null;
};

const EPSILON = 0.005;
const cents = (n: number) => Math.round(n * 100) / 100;

/** Steps a YYYY-MM key by whole months, rolling the year over as needed. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Every month from the first entry on the books through `thisMonth`, oldest
 * first — the months Classic's switcher pages through.
 */
export function monthsThrough(txns: readonly { date: string }[], thisMonth: string): string[] {
  const earliest = txns.reduce((min, t) => (t.date < min ? t.date : min), `${thisMonth}-01`).slice(0, 7);
  const out: string[] = [];
  for (let m = earliest, guard = 0; m <= thisMonth && guard < 1200; m = shiftMonth(m, 1), guard++) out.push(m);
  return out;
}

/** Every place money can be logged against, in Classic's order. */
export function boardTargets(properties: readonly BoardProperty[], units: readonly BoardUnit[]): BoardTarget[] {
  return properties.flatMap((p): BoardTarget[] => {
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
export function rentIndex(txns: readonly BoardTxn[]): Map<string, number> {
  const rent = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "rent") continue;
    for (const a of allocate(t)) {
      const key = `${t.propertyId}|${t.unitId ?? ""}|${a.month}`;
      rent.set(key, (rent.get(key) ?? 0) + a.amount);
    }
  }
  return rent;
}

export type BoardInput<T extends BoardTenant> = {
  month: string;
  /** YYYY-MM-DD */
  today: string;
  /** The properties in view (already narrowed to the chosen LLC). */
  properties: readonly BoardProperty[];
  /** Every unit; only those of properties in view are used. */
  units: readonly BoardUnit[];
  tenants: readonly T[];
  /** Every entry on the books; only rent in the month counts. */
  transactions: readonly BoardTxn[];
  rentChanges: readonly RentChangeDTO[];
  /** Late fees on the books, keyed "tenantId|YYYY-MM". */
  lateFees: Record<string, number>;
};

export type Board<T extends BoardTenant> = {
  lanes: Record<Lane, BoardCard<T>[]>;
  /** Classic's rent roll bar: capped per unit, over units with rent due. */
  collection: { expected: number; collected: number; paidCount: number; dueCount: number };
  /** Classic's "Rent collected" figure: every rent entry in the month, uncapped. */
  rentIn: number;
  /** Classic's Needs attention rent rows: owed for the month, late or not. */
  owedCount: number;
};

export function buildBoard<T extends BoardTenant>(input: BoardInput<T>): Board<T> {
  const { month, today, properties, units, tenants, transactions, rentChanges, lateFees } = input;
  const now = dateFromISO(today);
  const index = rentIndex(transactions);
  const byId = new Map(properties.map((p) => [p.id, p]));
  const unitsOf = (propertyId: string) => units.filter((u) => u.propertyId === propertyId);

  const expectedRent = (t: BoardTarget) =>
    rentForMonth(rentChanges as RentChangeDTO[], t.propertyId, t.unitId, month, t.monthlyRent);

  const rentInMonth = (propertyId: string, unitId: string | null) =>
    unitIdsCountingToward(unitId, unitsOf(propertyId)).reduce(
      (sum, u) => sum + (index.get(`${propertyId}|${u ?? ""}|${month}`) ?? 0),
      0
    );

  const tenantFor = (propertyId: string, unitId: string | null): T | null => {
    const propUnits = unitsOf(propertyId);
    const target = rentTargetOf(unitId, propUnits);
    return (
      tenants.find(
        (t) => t.active && t.propertyId === propertyId && rentTargetOf(t.unitId ?? null, propUnits) === target
      ) ?? null
    );
  };

  const lanes: Record<Lane, BoardCard<T>[]> = { late: [], due: [], vacant: [], ended: [], paid: [] };
  const collection = { expected: 0, collected: 0, paidCount: 0, dueCount: 0 };
  let owedCount = 0;

  for (const target of boardTargets(properties, units)) {
    const property = byId.get(target.propertyId)!;
    const expected = expectedRent(target);
    const paid = rentInMonth(target.propertyId, target.unitId);
    const tenant = tenantFor(target.propertyId, target.unitId);
    const fees = tenant ? lateFees[`${tenant.id}|${month}`] ?? 0 : 0;
    const lease = tenant ? leaseStatus(tenant, now) : null;

    // Classic's rent roll: capped per unit so one double payment can't hide
    // someone who paid nothing.
    if (!target.vacant && expected > 0) {
      collection.expected += expected;
      collection.collected += Math.min(paid, expected);
      collection.dueCount += 1;
      if (paid >= expected) collection.paidCount += 1;
    }

    const owes = !target.vacant && expected > 0 && paid < expected + fees - EPSILON;
    if (owes) owedCount += 1;

    let lane: Lane | null;
    if (target.vacant) lane = "vacant";
    else if (owes) lane = tenant && daysLate(month, tenant.dueDay, now) > 0 ? "late" : "due";
    else if (target.whole) lane = null; // the building-wide line only shows when it's owed
    else if (!tenant || lease?.kind === "expired") lane = "ended";
    else lane = "paid";
    if (!lane) continue;

    const total = expected + fees;
    lanes[lane].push({
      target,
      property,
      unitName: target.unitId ? units.find((u) => u.id === target.unitId)?.name ?? null : null,
      lane,
      tenant,
      lease,
      expected,
      paid,
      fees,
      owed: Math.max(0, cents(total - paid)),
      lateDays: tenant ? Math.max(0, daysLate(month, tenant.dueDay, now)) : 0,
      partial: owes && paid > EPSILON,
      progress: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0,
      vacantDays: target.vacant && target.vacantSince ? vacantDays(target.vacantSince.slice(0, 10), today) : null,
    });
  }

  // Longest overdue first, then most outstanding — Needs attention's order.
  lanes.late.sort((a, b) => b.lateDays - a.lateDays || b.owed - a.owed);
  lanes.due.sort((a, b) => b.owed - a.owed);
  lanes.vacant.sort((a, b) => (b.vacantDays ?? -1) - (a.vacantDays ?? -1));

  const ids = new Set(properties.map((p) => p.id));
  let rentIn = 0;
  for (const t of spreadForReports(transactions)) {
    if (t.type === "rent" && ids.has(t.propertyId) && t.date.startsWith(month)) rentIn += t.amount;
  }

  return { lanes, collection, rentIn, owedCount };
}
