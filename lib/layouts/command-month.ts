/**
 * The month on the Command Center overview, worked out from the same data
 * and the same rules as the Classic dashboard (app/dashboard/DashboardClient),
 * so the two layouts can never show different figures for one month:
 *
 * - a rent target is a property with no units, each unit of one that has
 *   them, and the "whole building" of a property with units (rent logged
 *   there counts for no unit), exactly as Classic's visibleTargets;
 * - expected rent is what the place rented for *that* month (rentForMonth);
 * - on a single-unit property, rent logged on the property counts toward the
 *   unit (unitIdsCountingToward);
 * - "collected" caps each target at what it owes, so one tenant paying double
 *   can't hide another who paid nothing (Classic's rent roll bar);
 * - a target owes when paid < expected + that month's late fees (Classic's
 *   Needs attention list), and "outstanding" is the sum of what those rows
 *   show as owed.
 *
 * Pure, relative imports only, so it runs under node's test runner.
 */

import { rentForMonth, type RentChangeDTO } from "../rent.ts";
import { allocate, spreadForReports } from "../spread.ts";
import { rentTargetOf, unitIdsCountingToward } from "../rent-target.ts";
import { daysLate, leaseStatus } from "../lease.ts";

export type MonthCompany = { id: string; name: string };
export type MonthProperty = {
  id: string;
  companyId: string;
  name: string;
  address: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};
export type MonthUnit = {
  id: string;
  propertyId: string;
  name: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
};
export type MonthTenant = {
  id: string;
  propertyId: string;
  unitId: string | null;
  name: string;
  dueDay: number;
  leaseStart: string;
  leaseEnd: string;
  active: boolean;
};
export type MonthTransaction = {
  propertyId: string;
  unitId: string | null;
  appliesTo?: string | null;
  spreadMonths?: number | null;
  type: "rent" | "expense";
  date: string;
  amount: number;
};

/** A place money can be logged against — the same shape Classic's record sheet takes. */
export type Target = {
  key: string;
  propertyId: string;
  unitId: string | null;
  label: string;
  monthlyRent: number;
  vacant: boolean;
  vacantSince: string | null;
  /** The "(whole building)" option of a property with units: never a rentable place. */
  whole: boolean;
};

export type RowStatus = "paid" | "partial" | "late" | "due" | "vacant" | "ended" | "norent";

export type TargetRow<T extends MonthTenant = MonthTenant> = {
  target: Target;
  property: MonthProperty;
  unitName: string | null;
  companyId: string;
  tenant: T | null;
  expected: number;
  paid: number;
  fees: number;
  /** What is still owed for the month (rent + fees − paid), never negative. */
  balance: number;
  /** Days past the tenant's due day; 0 when not late (or no tenant). */
  late: number;
  status: RowStatus;
};

export type MonthModel<T extends MonthTenant = MonthTenant> = {
  targets: Target[];
  /** One row per rentable place (no "whole building" rows), in property order. */
  rows: TargetRow<T>[];
  /** Rows that owe money this month, longest overdue first — Classic's order. */
  owed: TargetRow<T>[];
  expected: number;
  collected: number;
  paidCount: number;
  dueCount: number;
  /** collected / expected as a whole percent, capped at 100; 0 when nothing is due. */
  collectedPct: number;
  outstanding: number;
  /** Every rent entry in the month for the places in view (Classic's "Rent collected"). */
  rentReceived: number;
  /** Every expense entry in the month for the places in view. */
  expenses: number;
  expenseCount: number;
  occupied: number;
  rentable: number;
  byCompany: { company: MonthCompany; expected: number; collected: number; pct: number }[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Which LLC a stored selection means: a valid company id, or "all". */
export function resolveCompany(selected: string | null | undefined, companies: readonly { id: string }[]): string {
  if (companies.length === 1) return companies[0].id;
  if (selected && companies.some((c) => c.id === selected)) return selected;
  return "all";
}

/** Steps a YYYY-MM key by whole months. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Every month from the earliest entry through the current one (Classic's month picker range). */
export function monthRange(dates: readonly string[], thisMonth: string): string[] {
  let earliest = `${thisMonth}-01`;
  for (const d of dates) if (d < earliest) earliest = d;
  const list: string[] = [];
  let key = earliest.slice(0, 7);
  while (key <= thisMonth) {
    list.push(key);
    key = shiftMonth(key, 1);
  }
  return list;
}

/** The one status a row shows: money first, then the lease. */
export function rowStatus(o: {
  vacant: boolean;
  expected: number;
  paid: number;
  fees: number;
  late: number;
  leaseEnded: boolean;
}): RowStatus {
  if (o.vacant) return "vacant";
  if (o.expected <= 0) return "norent";
  const owes = o.paid < o.expected + o.fees - 0.005;
  if (owes) {
    if (o.late > 0) return "late";
    return o.paid > 0 ? "partial" : "due";
  }
  return o.leaseEnded ? "ended" : "paid";
}

/** Classic's visibleTargets for a set of properties. */
export function targetsFor(properties: readonly MonthProperty[], units: readonly MonthUnit[]): Target[] {
  return properties.flatMap((p): Target[] => {
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

export function monthModel<T extends MonthTenant>(input: {
  companies: readonly MonthCompany[];
  properties: readonly MonthProperty[];
  units: readonly MonthUnit[];
  tenants: readonly T[];
  transactions: readonly MonthTransaction[];
  rentChanges: RentChangeDTO[];
  /** Late fees on the books, keyed "tenantId|YYYY-MM". */
  lateFees: Record<string, number>;
  /** "all" or a company id. */
  company: string;
  month: string;
  /** YYYY-MM-DD, the viewer's today. */
  today: string;
}): MonthModel<T> {
  const { companies, properties, units, tenants, transactions, rentChanges, lateFees, company, month, today } = input;
  const [ty, tm, td] = today.split("-").map(Number);
  const now = new Date(ty, tm - 1, td);

  const visible = company === "all" ? properties : properties.filter((p) => p.companyId === company);
  const visibleIds = new Set(visible.map((p) => p.id));
  const propById = new Map(properties.map((p) => [p.id, p]));
  const unitsOf = new Map<string, MonthUnit[]>();
  for (const u of units) {
    const list = unitsOf.get(u.propertyId) ?? [];
    list.push(u);
    unitsOf.set(u.propertyId, list);
  }
  const unitsFor = (id: string) => unitsOf.get(id) ?? [];

  // Rent per place per month, summed in ledger order like Classic's index.
  const rentIndex = new Map<string, number>();
  let rentReceived = 0;
  let expenses = 0;
  let expenseCount = 0;
  for (const t of transactions) {
    if (t.type === "rent") {
      for (const a of allocate(t)) {
        const key = `${t.propertyId}|${t.unitId ?? ""}|${a.month}`;
        rentIndex.set(key, (rentIndex.get(key) ?? 0) + a.amount);
      }
    }
  }
  // The month's figures count a spread entry's share (lib/spread).
  for (const t of spreadForReports(transactions)) {
    if (t.date.slice(0, 7) === month && visibleIds.has(t.propertyId)) {
      if (t.type === "rent") rentReceived += t.amount;
      else {
        expenses += t.amount;
        expenseCount += 1;
      }
    }
  }
  const rentIn = (propertyId: string, unitId: string | null) =>
    unitIdsCountingToward(unitId, unitsFor(propertyId)).reduce(
      (sum, u) => sum + (rentIndex.get(`${propertyId}|${u ?? ""}|${month}`) ?? 0),
      0
    );
  const tenantFor = (propertyId: string, unitId: string | null): T | null => {
    const propUnits = unitsFor(propertyId);
    const target = rentTargetOf(unitId, propUnits);
    return (
      tenants.find(
        (t) => t.active && t.propertyId === propertyId && rentTargetOf(t.unitId ?? null, propUnits) === target
      ) ?? null
    );
  };

  const targets = targetsFor(visible, units);
  const rows: TargetRow<T>[] = [];
  const owed: TargetRow<T>[] = [];
  let expected = 0;
  let collected = 0;
  let paidCount = 0;
  let dueCount = 0;
  let occupied = 0;
  let rentable = 0;
  const perCompany = new Map<string, { expected: number; collected: number }>();

  for (const t of targets) {
    const property = propById.get(t.propertyId)!;
    const due = rentForMonth(rentChanges, t.propertyId, t.unitId, month, t.monthlyRent);
    const paid = rentIn(t.propertyId, t.unitId);
    const tenant = tenantFor(t.propertyId, t.unitId);
    const fees = tenant ? lateFees[`${tenant.id}|${month}`] ?? 0 : 0;
    const late = tenant ? Math.max(0, daysLate(month, tenant.dueDay, now)) : 0;

    if (!t.vacant && due > 0) {
      expected += due;
      collected += Math.min(paid, due);
      dueCount += 1;
      if (paid >= due) paidCount += 1;
      const c = perCompany.get(property.companyId) ?? { expected: 0, collected: 0 };
      c.expected += due;
      c.collected += Math.min(paid, due);
      perCompany.set(property.companyId, c);
    }

    const row: TargetRow<T> = {
      target: t,
      property,
      unitName: t.unitId ? unitsFor(t.propertyId).find((u) => u.id === t.unitId)?.name ?? null : null,
      companyId: property.companyId,
      tenant,
      expected: due,
      paid,
      fees,
      balance: t.vacant || due <= 0 ? 0 : Math.max(0, cents(due + fees - paid)),
      late,
      status: rowStatus({
        vacant: t.vacant,
        expected: due,
        paid,
        fees,
        late,
        leaseEnded: tenant ? leaseStatus(tenant, now).kind === "expired" : false,
      }),
    };
    if (!t.vacant && due > 0 && paid < due + fees - 0.005) owed.push(row);
    if (!t.whole) {
      rows.push(row);
      rentable += 1;
      if (!t.vacant) occupied += 1;
    }
  }

  owed.sort((a, b) => b.late - a.late || b.expected + b.fees - b.paid - (a.expected + a.fees - a.paid));
  const outstanding = cents(owed.reduce((sum, r) => sum + (r.expected + r.fees - r.paid), 0));
  const pctOf = (c: number, e: number) => (e > 0 ? Math.min(100, Math.round((c / e) * 100)) : 0);

  return {
    targets,
    rows,
    owed,
    expected,
    collected,
    paidCount,
    dueCount,
    collectedPct: pctOf(collected, expected),
    outstanding,
    rentReceived,
    expenses,
    expenseCount,
    occupied,
    rentable,
    byCompany: companies
      .filter((c) => company === "all" || c.id === company)
      .map((c) => {
        const s = perCompany.get(c.id) ?? { expected: 0, collected: 0 };
        return { company: c, ...s, pct: pctOf(s.collected, s.expected) };
      }),
  };
}
