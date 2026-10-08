import { test } from "node:test";
import assert from "node:assert/strict";
import { effectivePaymentDay, isMonthKey, monthLabel, parseAppliesTo, rentMonthOf } from "../lib/rent-month.ts";
import { buildMonth } from "../lib/calendar.ts";

test("a payment counts toward its chosen month, or else the month it's dated in", () => {
  assert.equal(rentMonthOf({ date: "2026-10-03" }), "2026-10");
  assert.equal(rentMonthOf({ date: "2026-10-03", appliesTo: null }), "2026-10");
  assert.equal(rentMonthOf({ date: "2026-10-03", appliesTo: "2026-09" }), "2026-09");
  assert.equal(rentMonthOf({ date: new Date("2026-09-28T12:00:00Z"), appliesTo: "2026-10" }), "2026-10");
  // Junk in the column never moves a payment.
  assert.equal(rentMonthOf({ date: "2026-10-03", appliesTo: "2026-13" }), "2026-10");
  assert.equal(rentMonthOf({ date: "2026-10-03", appliesTo: "soon" }), "2026-10");
});

test("for late fees: paid late counts from when it came, paid early from the 1st of its month", () => {
  // September's rent arriving October 3rd was late — it arrived on the 3rd.
  assert.equal(effectivePaymentDay({ date: "2026-10-03", appliesTo: "2026-09" }), "2026-10-03");
  // October's rent paid September 28th was there on October 1st.
  assert.equal(effectivePaymentDay({ date: "2026-09-28", appliesTo: "2026-10" }), "2026-10-01");
  assert.equal(effectivePaymentDay({ date: "2026-10-05" }), "2026-10-05");
});

test("what a form sends is checked, and its own month is stored as none", () => {
  const oct3 = new Date("2026-10-03T00:00:00Z");
  assert.equal(parseAppliesTo(undefined, oct3), undefined);
  assert.equal(parseAppliesTo(null, oct3), null);
  assert.equal(parseAppliesTo("", oct3), null);
  assert.equal(parseAppliesTo("2026-09", oct3), "2026-09");
  assert.equal(parseAppliesTo("2026-10", oct3), null);
  assert.equal(parseAppliesTo("2026-9", oct3), false);
  assert.equal(parseAppliesTo("2026-00", oct3), false);
  assert.equal(parseAppliesTo(202609, oct3), false);
  assert.ok(isMonthKey("2026-12") && !isMonthKey("2026-12-01"));
  assert.equal(monthLabel("2026-09"), "September 2026");
});

test("the calendar marks money on the day it landed but pays the month it counts toward", () => {
  const target = { key: "p|", propertyId: "p", unitId: null, label: "House", companyId: "c", vacant: false };
  const tenant = { id: "t", name: "Sam", propertyId: "p", unitId: null, dueDay: 1, phone: "" };
  const opts = {
    targets: [target],
    tenants: [tenant],
    rentFor: () => 1000,
    payments: [{ propertyId: "p", unitId: null, date: "2026-10-03", amount: 1000, appliesTo: "2026-09" }],
    today: "2026-10-10",
  };
  const sept = buildMonth({ ...opts, month: "2026-09" });
  const oct = buildMonth({ ...opts, month: "2026-10" });
  assert.equal(sept.collected, 1000, "September is paid");
  assert.equal(oct.collected, 0, "October is not");
  assert.equal(oct.days[2].received, 1000, "but the money is shown on October 3rd, when it came");
});
