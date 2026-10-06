import test from "node:test";
import assert from "node:assert/strict";
import { monthModel, monthRange, resolveCompany, rowStatus, shiftMonth } from "../lib/layouts/command-month.ts";

const companies = [
  { id: "c1", name: "Maple LLC" },
  { id: "c2", name: "Harbor LLC" },
];
const properties = [
  { id: "p1", companyId: "c1", name: "12 Oak", address: "12 Oak St", monthlyRent: 1000, vacant: false, vacantSince: null },
  { id: "p2", companyId: "c1", name: "Duplex", address: "5 Elm", monthlyRent: 0, vacant: false, vacantSince: null },
  { id: "p3", companyId: "c2", name: "Cabin", address: "", monthlyRent: 800, vacant: true, vacantSince: "2026-08-01" },
  { id: "p4", companyId: "c2", name: "Solo", address: "", monthlyRent: 0, vacant: false, vacantSince: null },
];
const units = [
  { id: "u1", propertyId: "p2", name: "A", monthlyRent: 700, vacant: false, vacantSince: null },
  { id: "u2", propertyId: "p2", name: "B", monthlyRent: 650, vacant: false, vacantSince: null },
  // Single-unit property: rent logged on the property counts for the unit.
  { id: "u3", propertyId: "p4", name: "#1", monthlyRent: 900, vacant: false, vacantSince: null },
];
const tenant = (id: string, propertyId: string, unitId: string | null, extra = {}) => ({
  id,
  propertyId,
  unitId,
  name: id.toUpperCase(),
  dueDay: 1,
  leaseStart: "2025-01-01",
  leaseEnd: "2027-01-01",
  active: true,
  ...extra,
});
const tenants = [
  tenant("t1", "p1", null),
  tenant("t2", "p2", "u1"),
  tenant("t3", "p2", "u2", { leaseEnd: "2026-08-31" }),
  tenant("t4", "p4", null),
];
const tx = (propertyId: string, unitId: string | null, amount: number, date = "2026-09-03", type: "rent" | "expense" = "rent") => ({
  propertyId,
  unitId,
  type,
  date,
  amount,
});

test("collected caps each place at what it owes; outstanding includes late fees", () => {
  const m = monthModel({
    companies,
    properties,
    units,
    tenants,
    transactions: [
      tx("p1", null, 1200), // overpaid: counts 1000
      tx("p2", "u1", 300), // partial
      tx("p4", null, 900), // whole property of a one-unit property -> unit u3
      tx("p1", null, 250, "2026-09-10", "expense"),
      tx("p1", null, 999, "2026-08-02"), // other month
    ],
    rentChanges: [],
    lateFees: { "t2|2026-09": 50 },
    company: "all",
    month: "2026-09",
    today: "2026-09-20",
  });
  assert.equal(m.expected, 1000 + 700 + 650 + 900);
  assert.equal(m.collected, 1000 + 300 + 900);
  assert.equal(m.dueCount, 4);
  assert.equal(m.paidCount, 2);
  assert.equal(m.collectedPct, Math.round((2200 / 3250) * 100));
  // t2 owes 700 + 50 - 300, t3 owes 650
  assert.equal(m.outstanding, 450 + 650);
  assert.deepEqual(
    m.owed.map((r) => r.target.key),
    ["p2:u2", "p2:u1"] // equally late: bigger balance first
  );
  assert.equal(m.rentReceived, 2400);
  assert.equal(m.expenses, 250);
  assert.equal(m.expenseCount, 1);
  // p1, u1, u2, p3 (vacant), u3 — no "whole building" rows
  assert.equal(m.rentable, 5);
  assert.equal(m.occupied, 4);
  const byKey = Object.fromEntries(m.rows.map((r) => [r.target.key, r]));
  assert.equal(byKey["p1"].status, "paid");
  assert.equal(byKey["p2:u1"].status, "late");
  assert.equal(byKey["p2:u1"].balance, 450);
  assert.equal(byKey["p2:u2"].status, "late");
  assert.equal(byKey["p3"].status, "vacant");
  assert.equal(byKey["p4:u3"].status, "paid");
  assert.equal(byKey["p4:u3"].tenant?.id, "t4");
  const c1 = m.byCompany.find((c) => c.company.id === "c1")!;
  assert.equal(c1.expected, 2350);
  assert.equal(c1.collected, 1300);
});

test("scoping to one LLC", () => {
  const m = monthModel({
    companies,
    properties,
    units,
    tenants,
    transactions: [tx("p4", "u3", 450)],
    rentChanges: [],
    lateFees: {},
    company: "c2",
    month: "2026-09",
    today: "2026-09-01",
  });
  assert.equal(m.expected, 900);
  assert.equal(m.collected, 450);
  assert.equal(m.byCompany.length, 1);
  // Due today is not late yet, and something came in: partial.
  assert.equal(m.rows.find((r) => r.target.key === "p4:u3")!.status, "partial");
});

test("expected rent follows the rent history for past months", () => {
  const m = monthModel({
    companies,
    properties: [properties[0]],
    units: [],
    tenants: [tenants[0]],
    transactions: [tx("p1", null, 900, "2026-03-02")],
    rentChanges: [{ id: "r", propertyId: "p1", unitId: null, effectiveFrom: "2026-06", amount: 1000 }],
    lateFees: {},
    company: "all",
    month: "2026-03",
    today: "2026-09-20",
  });
  // Before June 2026 the property rented for... the current figure, since
  // the first change backfills in real data. Here it falls back to 1000.
  assert.equal(m.expected, 1000);
  assert.equal(m.rows[0].status, "late");
});

test("rowStatus: money first, then the lease", () => {
  const base = { vacant: false, expected: 1000, paid: 1000, fees: 0, late: 5, leaseEnded: false };
  assert.equal(rowStatus(base), "paid");
  assert.equal(rowStatus({ ...base, leaseEnded: true }), "ended");
  assert.equal(rowStatus({ ...base, paid: 400, leaseEnded: true }), "late");
  assert.equal(rowStatus({ ...base, paid: 400, late: 0 }), "partial");
  assert.equal(rowStatus({ ...base, paid: 0, late: 0 }), "due");
  assert.equal(rowStatus({ ...base, fees: 35 }), "late");
  assert.equal(rowStatus({ ...base, vacant: true }), "vacant");
  assert.equal(rowStatus({ ...base, expected: 0 }), "norent");
});

test("month helpers", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.deepEqual(monthRange(["2026-07-15", "2026-09-01"], "2026-09"), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(monthRange([], "2026-09"), ["2026-09"]);
  assert.equal(resolveCompany("c2", companies), "c2");
  assert.equal(resolveCompany("gone", companies), "all");
  assert.equal(resolveCompany(null, [companies[0]]), "c1");
});
