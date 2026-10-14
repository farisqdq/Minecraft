import { test } from "node:test";
import assert from "node:assert/strict";
import { freeKeys, freeRentLabel, withFreeRent } from "../lib/free-rent.ts";
import { buildMonth } from "../lib/calendar.ts";

const free = [{ tenantId: "t1", propertyId: "p1", unitId: "u1", month: "2026-10", amount: 1200 }];

test("a free month counts toward that month's rent, on the same key the dashboards use", () => {
  const index = new Map([["p1|u1|2026-10", 200]]);
  const out = withFreeRent(index, free);
  assert.equal(out.get("p1|u1|2026-10"), 1400);
  assert.equal(index.get("p1|u1|2026-10"), 200, "the ledger's own index is left alone");
  assert.equal(withFreeRent(new Map(), undefined).size, 0);
});

test("labels and keys", () => {
  assert.equal(freeRentLabel(""), "Free month");
  assert.equal(freeRentLabel("  move-in special "), "Free month — move-in special");
  assert.deepEqual(freeKeys(free), { "t1|2026-10": true });
});

test("the calendar shows a free month as paid, with nothing marked as received", () => {
  const cal = buildMonth({
    month: "2026-10",
    targets: [{ key: "p1|u1", propertyId: "p1", unitId: "u1", label: "A", vacant: false }] as never,
    tenants: [{ id: "t1", name: "Sam", propertyId: "p1", unitId: "u1", dueDay: 1 }] as never,
    rentFor: () => 1200,
    payments: [],
    today: "2026-10-20",
    free,
  });
  const json = JSON.stringify(cal);
  assert.ok(!json.includes('"late"'), "not late");
  assert.equal(cal.days.reduce((s, d) => s + d.received, 0), 0);
});
