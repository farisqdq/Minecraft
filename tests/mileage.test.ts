import { test } from "node:test";
import assert from "node:assert/strict";
import { RATES, centsLabel, deductionFor, parseTripInput, rateOn, yearSummary } from "../lib/mileage.ts";

test("the rate is the one in force on the day, including the mid-year changes", () => {
  assert.equal(rateOn("2022-06-30")?.cents, 58.5);
  assert.equal(rateOn("2022-07-01")?.cents, 62.5);
  assert.equal(rateOn("2025-12-31")?.cents, 70);
  assert.equal(rateOn("2026-01-01")?.cents, 72.5);
  assert.equal(rateOn("2026-06-30")?.cents, 72.5);
  assert.equal(rateOn("2026-07-01")?.cents, 76);
  assert.equal(rateOn("2026-10-10")?.published, true);
  assert.equal(rateOn("2017-12-31"), null);
});

test("a year the IRS hasn't published yet uses the latest rate and says so", () => {
  const r = rateOn("2027-02-01");
  assert.equal(r?.cents, RATES[RATES.length - 1].cents);
  assert.equal(r?.published, false);
});

test("rates are in order, so the lookup's last match is the right one", () => {
  for (let i = 1; i < RATES.length; i++) assert.ok(RATES[i - 1].from < RATES[i].from);
});

test("deduction is miles × rate per rate period, to the cent", () => {
  const d = deductionFor([
    { date: "2026-03-02", miles: 12.4 },
    { date: "2026-05-10", miles: 7.6 },
    { date: "2026-07-01", miles: 30 },
    { date: "2026-09-15", miles: 0.3 },
  ]);
  assert.equal(d.miles, 50.3);
  // 20 mi × 72.5¢ = $14.50; 30.3 mi × 76¢ = $23.028 → $23.03.
  assert.deepEqual(d.byRate, [
    { cents: 72.5, from: "2026-01-01", miles: 20, amount: 14.5 },
    { cents: 76, from: "2026-07-01", miles: 30.3, amount: 23.03 },
  ]);
  assert.equal(d.amount, 37.53);
  assert.equal(d.unpublished, false);
});

test("a thousand miles is the same deduction as one trip or a hundred", () => {
  const one = deductionFor([{ date: "2025-04-01", miles: 1000 }]);
  const many = deductionFor(Array.from({ length: 100 }, () => ({ date: "2025-04-01", miles: 10 })));
  assert.equal(one.amount, 700);
  assert.equal(many.amount, 700);
  // Tenths add exactly, where 0.1 + 0.2 in floating point would not.
  assert.equal(deductionFor([{ date: "2025-01-02", miles: 0.1 }, { date: "2025-01-03", miles: 0.2 }]).miles, 0.3);
});

test("the year's total is exactly the sum of its properties", () => {
  const trips = [
    { date: "2026-03-01", miles: 10.1, propertyId: "a" },
    { date: "2026-08-01", miles: 10.1, propertyId: "a" },
    { date: "2026-03-01", miles: 3.3, propertyId: "b" },
    { date: "2025-12-31", miles: 99, propertyId: "b" },
  ];
  const y = yearSummary(trips, 2026);
  assert.equal(y.trips, 3);
  assert.equal(y.miles, 23.5);
  const sum = [...y.byProperty.values()].reduce((s, d) => s + Math.round(d.amount * 100), 0) / 100;
  assert.equal(y.amount, sum);
  assert.equal(y.byProperty.get("a")?.amount, 7.32 + 7.68);
});

test("a trip needs a real day, miles within reason, and a purpose", () => {
  const today = "2026-10-11";
  assert.deepEqual(parseTripInput({ date: "2026-10-10", miles: "12.46", purpose: "  Fix  the leak ", note: "" }, today), {
    ok: true,
    value: { date: "2026-10-10", miles: 12.5, purpose: "Fix the leak", note: "" },
  });
  assert.equal(parseTripInput({ date: "2026-10-12", miles: 5, purpose: "x" }, today).ok, false);
  assert.equal(parseTripInput({ date: "2016-01-01", miles: 5, purpose: "x" }, today).ok, false);
  assert.equal(parseTripInput({ date: "2026-10-10", miles: 0, purpose: "x" }, today).ok, false);
  assert.equal(parseTripInput({ date: "2026-10-10", miles: 2001, purpose: "x" }, today).ok, false);
  assert.equal(parseTripInput({ date: "2026-10-10", miles: "abc", purpose: "x" }, today).ok, false);
  assert.equal(parseTripInput({ date: "2026-10-10", miles: 5, purpose: "  " }, today).ok, false);
});

test("rates print as cents", () => {
  assert.equal(centsLabel(76), "76¢");
  assert.equal(centsLabel(72.5), "72.5¢");
});

test("a backup's trips come back exactly through JSON and the form's checks", () => {
  const trips = [
    { date: "2026-03-02", miles: 12.4, purpose: "Repair or maintenance", note: "" },
    { date: "2026-07-14", miles: 30, purpose: "Showing to a prospective tenant", note: "Unit 2" },
  ];
  const back = JSON.parse(JSON.stringify(trips)).map((t: unknown) => parseTripInput(t, "2026-10-11"));
  assert.deepEqual(back, trips.map((value) => ({ ok: true, value })));
});
