import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUTO_CHARGE,
  feeDueAt,
  graceElapsed,
  lateFeesFor,
  monthlyChargesFor,
  ruleAmount,
  ruleAppliesTo,
  ruleSummary,
  type ChargeRule,
} from "../lib/charge-rules.ts";
import { buildStatement, monthsBetween } from "../lib/balance.ts";

const rule = (over: Partial<ChargeRule> = {}): ChargeRule => ({
  id: "r1",
  kind: "late",
  label: "Late fee",
  amount: 50,
  percent: false,
  graceDays: 5,
  startMonth: null,
  endMonth: null,
  active: true,
  ...over,
});

const flat = (n: number) => () => n;
const utc = (s: string) => new Date(`${s}T12:00:00.000Z`);

/* ---- when a rule is in force ---- */

test("a rule off, or outside its months, does nothing", () => {
  assert.equal(ruleAppliesTo(rule({ active: false }), "2026-09"), false);
  assert.equal(ruleAppliesTo(rule({ startMonth: "2026-10" }), "2026-09"), false);
  assert.equal(ruleAppliesTo(rule({ endMonth: "2026-08" }), "2026-09"), false);
  assert.equal(ruleAppliesTo(rule({ startMonth: "2026-01", endMonth: "2026-12" }), "2026-09"), true);
  assert.equal(ruleAppliesTo(rule(), "rubbish"), false);
  // Garbage in the bounds is ignored rather than trusted to exclude a month.
  assert.equal(ruleAppliesTo(rule({ startMonth: "nonsense" }), "2026-09"), true);
});

test("flat and percentage amounts", () => {
  assert.equal(ruleAmount(rule({ amount: 50 }), 1550), 50);
  assert.equal(ruleAmount(rule({ amount: 5, percent: true }), 1550), 77.5);
  assert.equal(ruleAmount(rule({ amount: 5, percent: true }), 0), 0, "a percent of no rent is nothing");
  assert.equal(ruleAmount(rule({ amount: -100 }), 1550), 0, "a negative rule can't pay them");
});

test("a fat-fingered rule is capped", () => {
  // 50 typed where 5 was meant, on a commercial rent.
  assert.equal(ruleAmount(rule({ amount: 50, percent: true }), 9000), MAX_AUTO_CHARGE);
  assert.equal(ruleAmount(rule({ amount: 999999 }), 1000), MAX_AUTO_CHARGE);
});

/* ---- when the grace period runs out ---- */

test("the grace period lands on the right day", () => {
  assert.equal(feeDueAt("2026-09", 1, 5)?.toISOString().slice(0, 10), "2026-09-06");
  assert.equal(feeDueAt("2026-09", 1, 0)?.toISOString().slice(0, 10), "2026-09-01");
  // Rent due on the 31st in a 30-day month is due on the 30th, not October 1.
  assert.equal(feeDueAt("2026-09", 31, 0)?.toISOString().slice(0, 10), "2026-09-30");
  // And February is February.
  assert.equal(feeDueAt("2026-02", 31, 0)?.toISOString().slice(0, 10), "2026-02-28");
});

test("a fee is not chargeable until the grace period is up", () => {
  assert.equal(graceElapsed("2026-09", 1, 5, utc("2026-09-05")), false);
  assert.equal(graceElapsed("2026-09", 1, 5, utc("2026-09-06")), true);
  assert.equal(graceElapsed("2026-09", 1, 5, utc("2026-12-01")), true);
});

/* ---- what actually gets charged ---- */

test("no fee when they are square", () => {
  assert.deepEqual(
    lateFeesFor({ rules: [rule()], month: "2026-09", owed: 0, rentThisMonth: 1550, dueDay: 1, today: utc("2026-09-20") }),
    []
  );
});

test("no fee before the grace period, one after", () => {
  const args = { rules: [rule()], month: "2026-09", owed: 1550, rentThisMonth: 1550, dueDay: 1 };
  assert.deepEqual(lateFeesFor({ ...args, today: utc("2026-09-03") }), []);
  assert.deepEqual(lateFeesFor({ ...args, today: utc("2026-09-09") }), [
    { ruleId: "r1", label: "Late fee", amount: 50 },
  ]);
});

test("no fee in a month with no rent to be late with", () => {
  // A vacancy, or a tenant who had already moved out. An empty unit must not
  // quietly accrue late fees against nobody.
  assert.deepEqual(
    lateFeesFor({ rules: [rule()], month: "2026-09", owed: 900, rentThisMonth: 0, dueDay: 1, today: utc("2026-12-01") }),
    []
  );
});

test("a fee is never bigger than the debt it is charged on", () => {
  // $12 short after a payment that was twelve dollars light. A $50 fee here
  // is how a rounding error becomes an argument.
  assert.deepEqual(
    lateFeesFor({ rules: [rule()], month: "2026-09", owed: 12, rentThisMonth: 1550, dueDay: 1, today: utc("2026-09-20") }),
    [{ ruleId: "r1", label: "Late fee", amount: 12 }]
  );
});

test("a monthly charge is owed whether or not rent was paid", () => {
  const lot = rule({ id: "r2", kind: "monthly", label: "Lot fee", amount: 200 });
  assert.deepEqual(monthlyChargesFor({ rules: [lot], month: "2026-09", rentThisMonth: 1550 }), [
    { ruleId: "r2", label: "Lot fee", amount: 200 },
  ]);
  assert.deepEqual(
    monthlyChargesFor({ rules: [lot], month: "2026-09", rentThisMonth: 0 }),
    [],
    "but not against an empty unit"
  );
  // A late rule is not a monthly one and vice versa.
  assert.deepEqual(monthlyChargesFor({ rules: [rule()], month: "2026-09", rentThisMonth: 1550 }), []);
});

/* ---- the rules inside a real statement ---- */

test("a late fee lands in the month it was earned and compounds no further", () => {
  const rules = [rule()];
  const today = utc("2026-11-20");
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-11",
    rentFor: flat(1000),
    payments: [
      { month: "2026-09", amount: 0 },     // missed entirely
      { month: "2026-10", amount: 1000 },  // paid this month's rent only
      { month: "2026-11", amount: 1000 },
    ],
    assess: (month, owed, rent) =>
      lateFeesFor({ rules, month, owed, rentThisMonth: rent, dueDay: 1, today }).map((f) => ({
        month,
        kind: "fee" as const,
        amount: f.amount,
        label: f.label,
      })),
  });
  // Sept: 1000 rent + 50 fee = 1050 owed.
  assert.equal(s.rows[0].fees, 50);
  assert.equal(s.rows[0].balance, 1050);
  // Oct and Nov: this month's rent was paid, but the old hole is still open,
  // so the rule keeps charging — which is what a late fee is.
  assert.equal(s.rows[1].fees, 50);
  assert.equal(s.rows[2].fees, 50);
  assert.equal(s.balance, 1150);
});

test("paying on time means no fee is ever assessed", () => {
  const rules = [rule()];
  const today = utc("2026-12-31");
  const s = buildStatement({
    startMonth: "2026-01",
    currentMonth: "2026-12",
    rentFor: flat(1000),
    payments: monthsBetween("2026-01", "2026-12").map((month) => ({ month, amount: 1000 })),
    assess: (month, owed, rent) =>
      lateFeesFor({ rules, month, owed, rentThisMonth: rent, dueDay: 1, today }).map((f) => ({
        month,
        kind: "fee" as const,
        amount: f.amount,
        label: f.label,
      })),
  });
  assert.equal(s.balance, 0);
  assert.equal(s.charged, 12000, "twelve months of rent and not a cent of fees");
});

test("an assessed credit takes off rather than adding on", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    rentFor: flat(1000),
    assess: (month) => [{ month, kind: "credit", amount: 250, label: "Concession" }],
  });
  assert.equal(s.balance, 750);
  assert.equal(s.rows[0].credits, 250);
});

test("the one-line summary reads like English", () => {
  assert.equal(ruleSummary(rule({ kind: "monthly", amount: 200 }), 1), "$200 every month");
  assert.equal(
    ruleSummary(rule({ amount: 50, graceDays: 5 }), 1),
    "$50 if rent is still owed on the 6th"
  );
  assert.equal(
    ruleSummary(rule({ amount: 5, percent: true, graceDays: 2 }), 1),
    "5% of rent if rent is still owed on the 3rd"
  );
  assert.equal(ruleSummary(rule({ graceDays: 0 }), 1), "$50 if rent is late");
  // The 11th, 12th and 13th are not the 11st, 12nd and 13rd.
  assert.equal(
    ruleSummary(rule({ graceDays: 10 }), 1),
    "$50 if rent is still owed on the 11th"
  );
  assert.equal(
    ruleSummary(rule({ kind: "monthly", amount: 200, startMonth: "2026-09" }), 1),
    "$200 every month, from Sep 2026"
  );
});

test("a rule starting this month never reaches back into last year", () => {
  // The trap: a lot fee set up today with no start month would bill every
  // month already on the books the moment it was saved.
  const lot = rule({ kind: "monthly", label: "Lot fee", amount: 200, startMonth: "2026-09" });
  const billed = monthsBetween("2025-08", "2026-09").filter(
    (month) => monthlyChargesFor({ rules: [lot], month, rentThisMonth: 950 }).length > 0
  );
  assert.deepEqual(billed, ["2026-09"]);
});
