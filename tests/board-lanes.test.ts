import test from "node:test";
import assert from "node:assert/strict";
import { buildBoard, monthsThrough, shiftMonth } from "../lib/layouts/board-lanes.ts";

const properties = [
  { id: "p1", companyId: "c1", name: "Oak", address: "1 Oak", monthlyRent: 1000, vacant: false, vacantSince: null },
  { id: "p2", companyId: "c1", name: "Duplex", address: "2 Elm", monthlyRent: 0, vacant: false, vacantSince: null },
  { id: "p3", companyId: "c2", name: "Cabin", address: "", monthlyRent: 800, vacant: true, vacantSince: "2026-08-01" },
  { id: "p4", companyId: "c2", name: "Old", address: "", monthlyRent: 500, vacant: false, vacantSince: null },
];
const units = [
  { id: "u1", propertyId: "p2", name: "A", monthlyRent: 700, vacant: false, vacantSince: null },
  { id: "u2", propertyId: "p2", name: "B", monthlyRent: 650, vacant: false, vacantSince: null },
];
const t = (id: string, propertyId: string, unitId: string | null, extra = {}) => ({
  id, propertyId, unitId, name: id, phone: "", dueDay: 1, leaseStart: "2025-01-01", leaseEnd: "2027-01-01", active: true, ...extra,
});
const tenants = [t("t1", "p1", null), t("t2", "p2", "u1"), t("t3", "p2", "u2")];
const rent = (propertyId: string, unitId: string | null, amount: number) => ({
  propertyId, unitId, type: "rent" as const, date: "2026-09-03", amount,
});
const base = { month: "2026-09", today: "2026-09-20", properties, units, tenants, rentChanges: [], lateFees: {} };

test("lanes: paid, partial late, vacant, ended", () => {
  const b = buildBoard({ ...base, transactions: [rent("p1", null, 1000), rent("p2", "u1", 300), rent("p4", null, 500)] });
  assert.deepEqual(b.lanes.paid.map((c) => c.target.key), ["p1"]);
  const late = b.lanes.late.map((c) => c.target.key).sort();
  assert.deepEqual(late, ["p2:u1", "p2:u2"]);
  const partial = b.lanes.late.find((c) => c.target.key === "p2:u1")!;
  assert.equal(partial.partial, true);
  assert.equal(partial.owed, 400);
  assert.equal(partial.progress, 43);
  assert.deepEqual(b.lanes.vacant.map((c) => c.target.key), ["p3"]);
  assert.deepEqual(b.lanes.ended.map((c) => c.target.key), ["p4"]);
});

test("collected is capped per unit and late fees are owed", () => {
  const b = buildBoard({ ...base, transactions: [rent("p1", null, 1040)], lateFees: { "t1|2026-09": 50 } });
  assert.equal(b.collection.collected, 1000);
  assert.equal(b.rentIn, 1040);
  assert.equal(b.lanes.paid.length, 0);
  assert.equal(b.lanes.late.find((c) => c.target.key === "p1")!.fees, 50);
});

test("month helpers roll over years", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(monthsThrough([{ date: "2026-07-05" }], "2026-09"), ["2026-07", "2026-08", "2026-09"]);
});
