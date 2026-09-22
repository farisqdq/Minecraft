import test from "node:test";
import assert from "node:assert/strict";
import { buildMonth, compactMoney, daysInMonth, dueDayIn, shiftMonth, type CalTarget } from "../lib/calendar.ts";

const T = (key: string, over: Partial<CalTarget> = {}): CalTarget => ({
  key, propertyId: key, unitId: null, label: key, companyId: "c1", vacant: false, ...over,
});
const tenant = (propertyId: string, dueDay: number, name = propertyId + " tenant") => ({
  id: "t-" + propertyId, name, propertyId, unitId: null, dueDay, phone: "",
});

test("month lengths, leap years and short-month due days", () => {
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2028-02"), 29);
  assert.equal(daysInMonth("2026-09"), 30);
  assert.equal(dueDayIn("2026-02", 31), 28);
  assert.equal(dueDayIn("2026-09", 0), 1, "nonsense falls back to the 1st");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("the grid starts on the right weekday", () => {
  // 1 September 2026 is a Tuesday.
  const m = buildMonth({ month: "2026-09", targets: [], tenants: [], rentFor: () => 0, payments: [], today: "2026-09-22" });
  assert.equal(m.days.length, 30);
  assert.equal(m.days[0].weekday, 2);
  assert.equal(m.days[29].date, "2026-09-30");
});

test("rent lands on each tenant's due day and totals add up", () => {
  const m = buildMonth({
    month: "2026-09",
    targets: [T("a"), T("b"), T("c")],
    tenants: [tenant("a", 1), tenant("b", 15)],
    rentFor: (t) => ({ a: 1000, b: 1550, c: 800 })[t.key] ?? 0,
    payments: [],
    today: "2026-09-10",
  });
  assert.equal(m.days[0].expected, 1800, "a on the 1st, and c with no tenant defaults to the 1st");
  assert.equal(m.days[14].expected, 1550);
  assert.equal(m.expected, 3350);
  assert.equal(m.days.reduce((s, d) => s + d.expected, 0), m.expected, "the days sum to the month");
});

test("paid, partial, due and late are told apart", () => {
  const m = buildMonth({
    month: "2026-09",
    targets: [T("paid"), T("partial"), T("due"), T("late")],
    tenants: [tenant("paid", 1), tenant("partial", 25), tenant("due", 25), tenant("late", 5)],
    rentFor: () => 1000,
    payments: [
      { propertyId: "paid", unitId: null, date: "2026-09-02", amount: 1000 },
      { propertyId: "partial", unitId: null, date: "2026-09-03", amount: 400 },
      { propertyId: "late", unitId: null, date: "2026-09-04", amount: 100 },
    ],
    today: "2026-09-22",
  });
  const item = (k: string) => m.days.flatMap((d) => d.items).find((i) => i.key === k)!;
  assert.equal(item("paid").status, "paid");
  assert.equal(item("partial").status, "partial", "not yet due, something paid");
  assert.equal(item("due").status, "due");
  assert.equal(item("late").status, "late");
  assert.equal(item("late").daysLate, 17);
  assert.equal(m.overdue, 900, "only what is past its date counts as overdue");
  assert.equal(m.outstanding, 2500);
});

test("the due date itself is not late", () => {
  const m = buildMonth({
    month: "2026-09", targets: [T("a")], tenants: [tenant("a", 22)], rentFor: () => 1000, payments: [], today: "2026-09-22",
  });
  assert.equal(m.days[21].items[0].status, "due");
});

test("an overpayment can't hide someone else's shortfall", () => {
  const m = buildMonth({
    month: "2026-09",
    targets: [T("a"), T("b")],
    tenants: [tenant("a", 1), tenant("b", 1)],
    rentFor: () => 1000,
    payments: [{ propertyId: "a", unitId: null, date: "2026-09-01", amount: 2000 }],
    today: "2026-09-22",
  });
  assert.equal(m.collected, 1000, "capped per target");
  assert.equal(m.received, 2000, "but the bank still saw two thousand");
  assert.equal(m.outstanding, 1000);
});

test("money received is shown on the day it arrived", () => {
  const m = buildMonth({
    month: "2026-09", targets: [T("a")], tenants: [tenant("a", 1)], rentFor: () => 1000,
    payments: [
      { propertyId: "a", unitId: null, date: "2026-09-03", amount: 600 },
      { propertyId: "a", unitId: null, date: "2026-09-12", amount: 400 },
      { propertyId: "a", unitId: null, date: "2026-08-30", amount: 999 },
      { propertyId: "elsewhere", unitId: null, date: "2026-09-03", amount: 5 },
    ],
    today: "2026-09-22",
  });
  assert.equal(m.days[2].received, 600, "other targets and other months don't leak in");
  assert.equal(m.days[11].received, 400);
  assert.equal(m.days[0].items[0].status, "paid", "two part payments add up to paid");
});

test("vacant and zero-rent targets owe nothing", () => {
  const m = buildMonth({
    month: "2026-09",
    targets: [T("empty", { vacant: true }), T("free")],
    tenants: [],
    rentFor: (t) => (t.key === "empty" ? 1000 : 0),
    payments: [],
    today: "2026-09-22",
  });
  assert.equal(m.expected, 0);
  assert.equal(m.days.flatMap((d) => d.items).length, 0);
});

test("a recurring charge rides along on the rent's day, itemised", () => {
  const m = buildMonth({
    month: "2026-09",
    targets: [T("a")],
    tenants: [tenant("a", 1)],
    rentFor: () => 950,
    rules: [{
      id: "r", tenantId: "t-a", kind: "monthly", label: "Lot fee", amount: 200, percent: false,
      graceDays: 0, startMonth: "2026-09", endMonth: null, active: true,
    }],
    payments: [{ propertyId: "a", unitId: null, date: "2026-09-01", amount: 950 }],
    today: "2026-09-22",
  });
  const it = m.days[0].items[0];
  assert.deepEqual(it.extras, [{ label: "Lot fee", amount: 200 }]);
  assert.equal(it.expected, 1150);
  assert.equal(it.status, "late", "rent alone doesn't cover the lot fee");
  assert.equal(m.overdue, 200);
});

test("compact amounts fit a phone's calendar cell", () => {
  assert.equal(compactMoney(950), "$950");
  assert.equal(compactMoney(1550), "$1.6k");
  assert.equal(compactMoney(2000), "$2k");
  assert.equal(compactMoney(12450), "$12.4k");
  assert.equal(compactMoney(128000), "$128k");
});
