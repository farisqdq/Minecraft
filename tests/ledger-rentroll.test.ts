import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTargets,
  collectionOf,
  groupByCompany,
  matchesFilter,
  monthRange,
  occupancy,
  periodTotals,
  rentRollRows,
  rowCounts,
  shiftMonth,
  type LedgerProperty,
  type LedgerTenant,
  type LedgerTxn,
  type LedgerUnit,
} from "../lib/layouts/ledger-rentroll.ts";

const P = (o: Partial<LedgerProperty> & { id: string }): LedgerProperty => ({
  companyId: "c1",
  name: o.id,
  monthlyRent: 0,
  vacant: false,
  vacantSince: null,
  ...o,
});
const U = (o: Partial<LedgerUnit> & { id: string; propertyId: string }): LedgerUnit => ({
  name: o.id,
  monthlyRent: 0,
  vacant: false,
  vacantSince: null,
  ...o,
});
const T = (o: Partial<LedgerTenant> & { id: string; propertyId: string }): LedgerTenant => ({
  unitId: null,
  name: o.id,
  dueDay: 1,
  leaseStart: "2025-01-01",
  leaseEnd: "2027-12-31",
  active: true,
  ...o,
});
const rent = (propertyId: string, unitId: string | null, date: string, amount: number): LedgerTxn => ({
  propertyId,
  unitId,
  type: "rent",
  date,
  amount,
});

const properties = [
  P({ id: "house", monthlyRent: 1000 }),
  P({ id: "duplex" }),
  P({ id: "single" }), // one unit: rent on the property counts toward it
  P({ id: "empty", companyId: "c2", monthlyRent: 900, vacant: true, vacantSince: "2026-08-01" }),
];
const units = [
  U({ id: "A", propertyId: "duplex", monthlyRent: 800 }),
  U({ id: "B", propertyId: "duplex", monthlyRent: 700 }),
  U({ id: "S1", propertyId: "single", monthlyRent: 1200 }),
];
const tenants = [
  T({ id: "t-house", propertyId: "house", dueDay: 1 }),
  T({ id: "t-A", propertyId: "duplex", unitId: "A", dueDay: 5 }),
  T({ id: "t-B", propertyId: "duplex", unitId: "B", dueDay: 28, leaseEnd: "2026-10-15" }),
  T({ id: "t-S", propertyId: "single", unitId: null, leaseEnd: "2026-08-31" }),
];
const txns: LedgerTxn[] = [
  rent("house", null, "2026-09-02", 1000),
  rent("duplex", "A", "2026-09-06", 300),
  rent("single", null, "2026-09-01", 1200), // logged on the property, counts for S1
  { propertyId: "house", unitId: null, type: "expense", date: "2026-09-10", amount: 250 },
  rent("house", null, "2026-08-01", 1000),
];
const now = new Date(2026, 8, 20); // Sep 20, 2026

const rows = rentRollRows({
  properties,
  units,
  tenants,
  transactions: txns,
  rentChanges: [],
  lateFees: {},
  month: "2026-09",
  now,
});
const byKey = Object.fromEntries(rows.map((r) => [r.target.key, r]));

test("targets match Classic: houses, each unit, and a whole-building place", () => {
  const keys = buildTargets(properties, units).map((t) => t.key);
  assert.deepEqual(keys, ["house", "duplex:A", "duplex:B", "duplex:whole", "single:S1", "single:whole", "empty"]);
});

test("whole-building places with nothing due are not rows", () => {
  assert.equal(byKey["duplex:whole"], undefined);
  assert.equal(rows.length, 5);
});

test("each row gets the right status", () => {
  assert.equal(byKey.house.status, "paid");
  assert.equal(byKey["duplex:A"].status, "late"); // part paid, past the 5th
  assert.equal(byKey["duplex:A"].late, 15);
  assert.equal(byKey["duplex:A"].balance, 500);
  assert.equal(byKey["duplex:B"].status, "due"); // nothing paid, due on the 28th
  assert.equal(byKey["single:S1"].status, "ended"); // paid up, lease ran out
  assert.equal(byKey["single:S1"].paid, 1200);
  assert.equal(byKey.empty.status, "vacant");
});

test("collection caps each place at what it owes and skips vacant ones", () => {
  const c = collectionOf(rows);
  assert.equal(c.expected, 1000 + 800 + 700 + 1200);
  assert.equal(c.collected, 1000 + 300 + 1200);
  assert.equal(c.paidCount, 2);
  assert.equal(c.dueCount, 4);
  assert.equal(c.outstanding, 1200);
});

test("an overpayment cannot hide someone else's shortfall", () => {
  const extra = rentRollRows({
    properties,
    units,
    tenants,
    transactions: [...txns, rent("house", null, "2026-09-03", 5000)],
    rentChanges: [],
    lateFees: {},
    month: "2026-09",
    now,
  });
  assert.equal(collectionOf(extra).collected, 2500);
});

test("late fees keep a rent-paid month owed", () => {
  const withFee = rentRollRows({
    properties,
    units,
    tenants,
    transactions: txns,
    rentChanges: [],
    lateFees: { "t-house|2026-09": 50 },
    month: "2026-09",
    now,
  });
  const house = withFee.find((r) => r.target.key === "house")!;
  assert.equal(house.status, "late");
  assert.equal(house.balance, 50);
});

test("rent history decides what a past month expected", () => {
  const past = rentRollRows({
    properties,
    units,
    tenants,
    transactions: txns,
    rentChanges: [{ id: "x", propertyId: "house", unitId: null, effectiveFrom: "2026-09", amount: 1000 }],
    lateFees: {},
    month: "2026-08",
    now,
  });
  assert.equal(past.find((r) => r.target.key === "house")!.due, 1000);
});

test("counts, filters and LLC groups", () => {
  const c = rowCounts(rows);
  assert.deepEqual(c, { all: 5, late: 1, owed: 1, vacant: 1, paid: 2, leases: 2, review: 4 });
  assert.equal(rows.filter((r) => matchesFilter(r, "paid")).length, 2);
  assert.equal(rows.filter((r) => matchesFilter(r, "review")).length, 4);
  const groups = groupByCompany(rows, [
    { id: "c1", name: "One LLC" },
    { id: "c2", name: "Two LLC" },
    { id: "c3", name: "Nothing LLC" },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.company.name, g.rows.length, g.collected, g.expected]),
    [
      ["One LLC", 4, 2500, 3700],
      ["Two LLC", 1, 0, 0],
    ]
  );
});

test("period totals, months and occupancy", () => {
  assert.deepEqual(periodTotals(txns, "2026-09"), { rent: 2500, expense: 250, net: 2250 });
  assert.deepEqual(monthRange(txns, "2026-09"), ["2026-08", "2026-09"]);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(occupancy(properties, units), { occupied: 4, total: 5, pct: 80 });
});
