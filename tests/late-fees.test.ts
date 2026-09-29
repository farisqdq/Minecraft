import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUTO_CHARGE,
  lateFeesFor,
  ruleSummary,
  type AppliedFee,
  type AssessedFee,
  type ChargeRule,
  type DatedPayment,
} from "../lib/charge-rules.ts";
import { buildStatement } from "../lib/balance.ts";
import {
  DEFAULT_POLICY,
  parseLateFeeMode,
  parsePolicy,
  policyRuleFields,
  policySentence,
} from "../lib/late-fee-policy.ts";
import { lateFeeSummary } from "../lib/late-fee-text.ts";

/* The owner's policy: 5 days' grace, 7% once, then $5 a day, at most 12%. */
const POLICY = { ...DEFAULT_POLICY, enabled: true };

const rule = (over: Partial<ChargeRule> = {}): ChargeRule => ({
  id: "p",
  ...policyRuleFields(POLICY),
  startMonth: null,
  endMonth: null,
  active: true,
  fromPolicy: true,
  ...over,
});

const utc = (s: string) => new Date(`${s}T12:00:00.000Z`);
const cents = (n: number) => Math.round(n * 100) / 100;
const total = (fees: { amount: number }[]) => cents(fees.reduce((s, f) => s + f.amount, 0));
const daily = (fees: AssessedFee[]) => fees.filter((f) => f.day);

/**
 * The daily cron, in miniature: one call per day, each seeing only the
 * payments recorded by then, with every earlier day's fees on the books and
 * on record. What comes out is what the tenant's account would show.
 */
function simulate(opts: {
  rent: number;
  dueDay?: number;
  rules?: ChargeRule[];
  month: string;
  payments?: DatedPayment[];
  from: string;
  to: string;
}) {
  const { rent, dueDay = 1, rules = [rule()], month, payments = [], from, to } = opts;
  const applied: (AppliedFee & { month: string })[] = [];
  const charged: (AssessedFee & { day: string; on: string })[] = [];
  let day = from;
  while (day <= to) {
    const known = payments.filter((p) => p.day <= day);
    const paidThisMonth = known
      .filter((p) => p.day.slice(0, 7) === month)
      .reduce((s, p) => s + p.amount, 0);
    const owed = cents(rent + total(charged) - paidThisMonth);
    const fees = lateFeesFor({
      rules,
      month,
      owed,
      rentThisMonth: rent,
      dueDay,
      today: utc(day),
      payments: known,
      applied,
    });
    for (const f of fees) {
      applied.push({ ruleId: f.ruleId, month, day: f.day ?? "", amount: f.amount });
      charged.push({ ...f, day: f.day ?? "", on: day });
    }
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    day = d.toISOString().slice(0, 10);
  }
  return charged;
}

/* ---- the grace boundary ---- */

test("nothing on day 5, the one-time fee on day 6, the first daily fee on day 7", () => {
  const args = { rules: [rule()], month: "2026-09", owed: 1000, rentThisMonth: 1000, dueDay: 1 };
  assert.deepEqual(lateFeesFor({ ...args, today: utc("2026-09-05") }), []);
  assert.deepEqual(lateFeesFor({ ...args, today: utc("2026-09-06") }), [
    { ruleId: "p", label: "Late fee", amount: 70 },
  ]);
  assert.deepEqual(lateFeesFor({ ...args, today: utc("2026-09-07") }), [
    { ruleId: "p", label: "Late fee", amount: 70 },
    { ruleId: "p", label: "Late fee (Sep 7)", amount: 5, day: "2026-09-07" },
  ]);
});

/* ---- the cap ---- */

test("$1,000 rent: $70, then $5 a day, stopping at $120 after ten daily fees", () => {
  const fees = simulate({ rent: 1000, month: "2026-09", from: "2026-09-01", to: "2026-09-30" });
  assert.equal(total(fees), 120);
  assert.equal(daily(fees).length, 10);
  assert.deepEqual(
    daily(fees).map((f) => f.day),
    ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"]
  );
  // Each day's run saw the day before's fees and added exactly one of its own.
  assert.equal(fees.filter((f) => f.on === "2026-09-06").length, 1);
  assert.equal(fees.filter((f) => f.on === "2026-09-16").length, 1);
  assert.equal(fees.filter((f) => f.on >= "2026-09-17").length, 0);
});

test("a run that missed days catches up in one go, to the same total", () => {
  // No cron for the whole month, then one call on the 30th.
  const fees = lateFeesFor({
    rules: [rule()],
    month: "2026-09",
    owed: 1000,
    rentThisMonth: 1000,
    dueDay: 1,
    today: utc("2026-09-30"),
  });
  assert.equal(total(fees), 120);
  assert.equal(daily(fees).length, 10);
  // And a second call with those on record adds nothing.
  const applied = fees.map((f) => ({ ruleId: f.ruleId, day: f.day ?? "", amount: f.amount }));
  assert.deepEqual(
    lateFeesFor({ rules: [rule()], month: "2026-09", owed: 1120, rentThisMonth: 1000, dueDay: 1, today: utc("2026-10-15"), applied }),
    []
  );
});

test("the cap counts fees the landlord deleted; deleting is a gift, not a reset", () => {
  // Ten daily fees on record; the charge for the 8th was deleted, so it is
  // no longer part of what's owed — but the 8th is not run again and the
  // cap is still full.
  const applied: AppliedFee[] = [{ ruleId: "p", day: "", amount: 70 }];
  for (let d = 7; d <= 16; d++) applied.push({ ruleId: "p", day: `2026-09-${String(d).padStart(2, "0")}`, amount: 5 });
  assert.deepEqual(
    lateFeesFor({ rules: [rule()], month: "2026-09", owed: 1115, rentThisMonth: 1000, dueDay: 1, today: utc("2026-09-30"), applied }),
    []
  );
});

test("a deleted daily fee is never re-applied, even with room under the cap", () => {
  const applied: AppliedFee[] = [
    { ruleId: "p", day: "", amount: 70 },
    { ruleId: "p", day: "2026-09-07", amount: 5 },
    { ruleId: "p", day: "2026-09-08", amount: 5 }, // charge since deleted
  ];
  const fees = lateFeesFor({
    rules: [rule()],
    month: "2026-09",
    owed: 1075,
    rentThisMonth: 1000,
    dueDay: 1,
    today: utc("2026-09-10"),
    applied,
  });
  assert.deepEqual(daily(fees).map((f) => f.day), ["2026-09-09", "2026-09-10"]);
});

/* ---- payments ---- */

test("paid mid-accrual: fees stop the day the rent is paid", () => {
  const fees = simulate({
    rent: 1000,
    month: "2026-09",
    payments: [{ day: "2026-09-10", amount: 1000 }],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  // $70 on the 6th, $5 on the 7th, 8th and 9th. Nothing on the 10th or after.
  assert.equal(total(fees), 85);
  assert.deepEqual(daily(fees).map((f) => f.day), ["2026-09-07", "2026-09-08", "2026-09-09"]);
  // The fees themselves are still owed, but they don't keep the meter running.
});

test("catching up after a payment lands the same fees as running daily would have", () => {
  // Nothing ran until the 20th; the tenant paid in full on the 10th.
  const fees = lateFeesFor({
    rules: [rule()],
    month: "2026-09",
    owed: 0,
    rentThisMonth: 1000,
    dueDay: 1,
    today: utc("2026-09-20"),
    payments: [{ day: "2026-09-10", amount: 1000 }],
  });
  assert.equal(total(fees), 85);
  assert.deepEqual(daily(fees).map((f) => f.day), ["2026-09-07", "2026-09-08", "2026-09-09"]);
});

test("paying on time means nothing is ever charged", () => {
  const fees = simulate({
    rent: 1000,
    month: "2026-09",
    payments: [{ day: "2026-09-03", amount: 1000 }],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  assert.deepEqual(fees, []);
});

test("a partial payment doesn't reset anything; accrual carries on against the remainder", () => {
  const fees = simulate({
    rent: 1000,
    month: "2026-09",
    payments: [{ day: "2026-09-08", amount: 800 }],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  // The one-time fee was on the full rent, and the daily fee keeps going on
  // the $200 still owed until the cap.
  assert.equal(fees[0].amount, 70);
  assert.equal(total(fees), 120);
  assert.equal(daily(fees).length, 10);
});

test("a fee is never bigger than what's still outstanding", () => {
  const fees = simulate({
    rent: 1000,
    month: "2026-09",
    payments: [{ day: "2026-09-08", amount: 997 }],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  // $70 on the 6th, $5 on the 7th, then $3 a day on the $3 shortfall.
  assert.deepEqual(fees.slice(0, 3).map((f) => f.amount), [70, 5, 3]);
  for (const f of daily(fees).slice(1)) assert.equal(f.amount, 3);
  assert.ok(total(fees) <= 120);
  // Paying the shortfall stops it.
  const paid = simulate({
    rent: 1000,
    month: "2026-09",
    payments: [
      { day: "2026-09-08", amount: 997 },
      { day: "2026-09-09", amount: 3 },
    ],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  assert.deepEqual(paid.map((f) => f.amount), [70, 5, 3]);
});

test("a month left unpaid keeps accruing into the next, until a later payment clears it", () => {
  // No cap, so the month boundary is the only thing that could stop it.
  const uncapped = [rule({ capPercent: 0 })];
  const fees = simulate({
    rent: 1000,
    rules: uncapped,
    month: "2026-09",
    payments: [{ day: "2026-10-03", amount: 1000 }],
    from: "2026-09-01",
    to: "2026-10-20",
  });
  // Sep 7–30 and Oct 1–2: 26 daily fees, then the October payment pays
  // September off (oldest first) and the meter stops.
  assert.equal(daily(fees).length, 26);
  assert.equal(daily(fees)[25].day, "2026-10-02");
  assert.equal(total(fees), 70 + 26 * 5);
});

/* ---- rent ---- */

test("the fee is a share of THAT month's rent, from the rent history", () => {
  const rules = [rule()];
  const today = utc("2026-09-30");
  const s = buildStatement({
    startMonth: "2026-08",
    currentMonth: "2026-09",
    rentFor: (m) => (m === "2026-08" ? 1000 : 1200), // raised in September
    payments: [],
    assess: (month, owed, rent) =>
      lateFeesFor({ rules, month, owed, rentThisMonth: rent, dueDay: 1, today }).map((f) => ({
        month,
        kind: "fee" as const,
        amount: f.amount,
        label: f.label,
      })),
  });
  // August: 7% of 1000 = 70, then $5/day up to 120.
  assert.equal(s.rows[0].fees, 120);
  // September: 7% of 1200 = 84, then $5/day up to 144 (= 84 + 12 × 5).
  assert.equal(s.rows[1].fees, 144);
});

test("a vacant month charges nothing", () => {
  assert.deepEqual(
    lateFeesFor({ rules: [rule()], month: "2026-09", owed: 900, rentThisMonth: 0, dueDay: 1, today: utc("2026-09-30") }),
    []
  );
});

test("MAX_AUTO_CHARGE still caps every single charge", () => {
  const wild = rule({ amount: 50, dailyAmount: 5000, capPercent: 0 });
  const fees = lateFeesFor({
    rules: [wild],
    month: "2026-09",
    owed: 50000,
    rentThisMonth: 9000,
    dueDay: 1,
    today: utc("2026-09-08"),
  });
  assert.deepEqual(fees.map((f) => f.amount), [MAX_AUTO_CHARGE, MAX_AUTO_CHARGE, MAX_AUTO_CHARGE]);
});

test("a rule that starts this month doesn't reach back", () => {
  const r = rule({ startMonth: "2026-09" });
  assert.deepEqual(
    lateFeesFor({ rules: [r], month: "2026-08", owed: 1000, rentThisMonth: 1000, dueDay: 1, today: utc("2026-09-30") }),
    []
  );
});

/* ---- words ---- */

test("the card summary reads like English", () => {
  assert.equal(ruleSummary(rule(), 1), "7% of rent 5 days after it's due, then $5/day up to 12%");
  assert.equal(
    ruleSummary(rule({ percent: false, amount: 50, capPercent: 0 }), 1),
    "$50 5 days after it's due, then $5/day"
  );
  assert.equal(ruleSummary(rule({ dailyAmount: 0, capPercent: 0 }), 1), "7% of rent if rent is still owed on the 6th");
  assert.equal(ruleSummary(rule({ graceDays: 0 }), 1), "7% of rent if rent is late, then $5/day up to 12%");
});

test("the policy sentence for the settings page", () => {
  assert.equal(
    policySentence(POLICY),
    "If rent is still owed 5 days after the due day, a late fee of 7% of that month's rent is charged, then $5 a day until it's paid, up to 12% of that month's rent ($120 on $1,000)."
  );
  assert.equal(policySentence({ ...POLICY, enabled: false }), "No late fees are charged automatically.");
  assert.equal(
    policySentence({ ...POLICY, dailyAmount: 0, capPercent: 0 }),
    "If rent is still owed 5 days after the due day, a late fee of 7% of that month's rent is charged."
  );
  assert.equal(
    policySentence({ ...POLICY, percent: 0, graceDays: 0 }),
    "If rent is still owed on the due day, $5 a day is charged until it's paid, up to 12% of that month's rent ($120 on $1,000)."
  );
});

test("the reminder line", () => {
  assert.equal(
    lateFeeSummary({ rent: 1000, policy: POLICY, feesSoFar: 70 }),
    "a $70 late fee was added; $5/day more until paid, up to $120"
  );
  assert.equal(
    lateFeeSummary({ rent: 1000, policy: POLICY, feesSoFar: 85 }),
    "a $85 late fee was added; $5/day more until paid, up to $120"
  );
  assert.equal(lateFeeSummary({ rent: 1000, policy: POLICY, feesSoFar: 120 }), "$120 in late fees was added, the most this month can carry");
  // Before anything has landed, say what applies rather than what was added.
  assert.equal(lateFeeSummary({ rent: 1000, policy: POLICY }), "a $70 late fee applies; $5/day more until paid, up to $120");
  assert.equal(lateFeeSummary({ rent: 1000, policy: { ...POLICY, enabled: false }, feesSoFar: 70 }), "");
  assert.equal(lateFeeSummary({ rent: 0, policy: POLICY }), "");
  assert.equal(
    lateFeeSummary({ rent: 1000, policy: { ...POLICY, dailyAmount: 0, capPercent: 0 }, feesSoFar: 70 }),
    "a $70 late fee was added"
  );
});

test("policy input is clamped, and a mode is one of three", () => {
  assert.deepEqual(parsePolicy({ enabled: true, graceDays: 99, percent: 250, dailyAmount: -4, capPercent: "12" }), {
    enabled: true,
    graceDays: 28,
    percent: 100,
    dailyAmount: 0,
    capPercent: 12,
  });
  assert.deepEqual(parsePolicy(null), DEFAULT_POLICY);
  assert.equal(parsePolicy({ percent: 9 }, POLICY).enabled, true, "fields left out keep the base");
  assert.equal(parseLateFeeMode("custom"), "custom");
  assert.equal(parseLateFeeMode("anything else"), "default");
});

/* ---- switching the policy on when rent is already overdue ---- */

test("switched on late in the month: the 7% fee now, daily fees only from tomorrow", () => {
  const on = rule({ accrueFrom: "2026-09-28" });
  const today = lateFeesFor({ rules: [on], month: "2026-09", owed: 1000, rentThisMonth: 1000, dueDay: 1, today: utc("2026-09-28") });
  assert.deepEqual(today, [{ ruleId: "p", label: "Late fee", amount: 70 }], "no backfill of Sep 7–28");
  const fees = simulate({ rent: 1000, rules: [on], month: "2026-09", from: "2026-09-28", to: "2026-09-30" });
  assert.deepEqual(fees.map((f) => [f.on, f.amount]), [["2026-09-28", 70], ["2026-09-29", 5], ["2026-09-30", 5]]);
});

test("switched on: the month still stops at 12%, whenever it started", () => {
  const fees = simulate({ rent: 1000, rules: [rule({ accrueFrom: "2026-09-28" })], month: "2026-09", from: "2026-09-28", to: "2026-11-30" });
  assert.equal(total(fees), 120);
  assert.equal(daily(fees).length, 10);
  assert.equal(daily(fees).at(-1)!.day, "2026-10-08");
});

test("switched on: nothing is charged for days before the policy existed, or before today", () => {
  const on = rule({ accrueFrom: "2026-09-28" });
  assert.deepEqual(lateFeesFor({ rules: [on], month: "2026-09", owed: 1000, rentThisMonth: 1000, dueDay: 1, today: utc("2026-09-27") }), []);
});

test("switched on: an earlier month still unpaid gets its 7% now too — but only what's genuinely unpaid", () => {
  const on = rule({ accrueFrom: "2026-09-28" });
  // August's rent never came: $70 on the day the policy went on.
  assert.deepEqual(
    lateFeesFor({ rules: [on], month: "2026-08", owed: 1000, rentThisMonth: 1000, dueDay: 1, today: utc("2026-09-28") }),
    [{ ruleId: "p", label: "Late fee", amount: 70 }]
  );
  // August was short at the end of August, but September's payments cleared
  // it (older rent is paid first): no fee for August.
  assert.deepEqual(
    lateFeesFor({
      rules: [on],
      month: "2026-08",
      owed: 1000,
      rentThisMonth: 1000,
      dueDay: 1,
      today: utc("2026-09-28"),
      payments: [{ day: "2026-09-10", amount: 2000 }],
    }),
    []
  );
});

test("switched on: rent paid before the policy went on is never charged", () => {
  assert.deepEqual(
    lateFeesFor({
      rules: [rule({ accrueFrom: "2026-09-28" })],
      month: "2026-09",
      owed: 0,
      rentThisMonth: 1000,
      dueDay: 1,
      today: utc("2026-09-28"),
      payments: [{ day: "2026-09-20", amount: 1000 }],
    }),
    []
  );
});

test("switched on: a vacant month carries no fee", () => {
  assert.deepEqual(
    lateFeesFor({ rules: [rule({ accrueFrom: "2026-09-28" })], month: "2026-09", owed: 0, rentThisMonth: 0, dueDay: 1, today: utc("2026-09-28") }),
    []
  );
});

/* ---- the Furniture Store case: $867.22 of $4,570 paid on Sep 9 ---- */

test("a partial payment leaves the month overdue: $3,702.78 still owed carries the full 7% ($319.90)", () => {
  const payments: DatedPayment[] = [{ day: "2026-09-09", amount: 867.22 }];
  const owed = cents(4570 - 867.22);
  assert.equal(owed, 3702.78);
  // The policy switched on today (Sep 29): the one-time fee now, nothing backfilled.
  const on = rule({ accrueFrom: "2026-09-29" });
  assert.deepEqual(
    lateFeesFor({ rules: [on], month: "2026-09", owed, rentThisMonth: 4570, dueDay: 1, today: utc("2026-09-29"), payments }),
    [{ ruleId: "p", label: "Late fee", amount: 319.9 }]
  );
  // On since before the month: $319.90 on the 6th, $5 a day from the 7th,
  // the partial payment on the 9th changing nothing but the remainder.
  const fees = simulate({ rent: 4570, month: "2026-09", payments, from: "2026-09-01", to: "2026-09-29" });
  assert.deepEqual(fees[0], { ruleId: "p", label: "Late fee", amount: 319.9, day: "", on: "2026-09-06" });
  assert.equal(daily(fees).length, 23, "Sep 7 to Sep 29");
  assert.equal(total(fees), 434.9, "under the $548.40 cap");
});

test("the statement: $4,570 due, $867.22 paid, $319.90 fee — $4,022.68 owed", () => {
  const s = buildStatement({
    startMonth: "2026-09",
    currentMonth: "2026-09",
    rentFor: () => 4570,
    payments: [{ month: "2026-09", amount: 867.22 }],
    assess: (month, owed, rent) =>
      lateFeesFor({
        rules: [rule({ accrueFrom: "2026-09-29" })],
        month,
        owed,
        rentThisMonth: rent,
        dueDay: 1,
        today: utc("2026-09-29"),
        payments: [{ day: "2026-09-09", amount: 867.22 }],
      }).map((f) => ({ month, kind: "fee" as const, amount: f.amount, label: f.label })),
  });
  assert.deepEqual(s.rows[0], { month: "2026-09", rent: 4570, fees: 319.9, credits: 0, paid: 867.22, balance: 4022.68 });
  assert.equal(s.behindSince, "2026-09");
});

test("the fee never exceeds what's owed: $100 left of $4,570 is a $100 fee", () => {
  const fees = lateFeesFor({
    rules: [rule({ accrueFrom: "2026-09-29" })],
    month: "2026-09",
    owed: 100,
    rentThisMonth: 4570,
    dueDay: 1,
    today: utc("2026-09-29"),
    payments: [{ day: "2026-09-09", amount: 4470 }],
  });
  assert.deepEqual(fees, [{ ruleId: "p", label: "Late fee", amount: 100 }]);
});

test("a deleted fee isn't taken off what's owed twice: daily fees go on while rent is unpaid", () => {
  // $1,000 rent, $950 paid on the 3rd: the one-time fee was $50 (all that
  // was owed) and the landlord deleted it. $50 of rent is still unpaid.
  const applied: AppliedFee[] = [{ ruleId: "p", day: "", amount: 50 }];
  const base = {
    rules: [rule()],
    month: "2026-09",
    owed: 50, // rent less payment; the deleted fee isn't in it
    rentThisMonth: 1000,
    dueDay: 1,
    today: utc("2026-09-08"),
    payments: [{ day: "2026-09-03", amount: 950 }],
    applied,
  };
  // Assuming every applied fee is still on the books reads $0 owed and stops.
  assert.deepEqual(lateFeesFor(base), []);
  // Told what's on the books (nothing), the $50 of rent keeps accruing.
  assert.deepEqual(
    daily(lateFeesFor({ ...base, booked: {} })).map((f) => [f.day, f.amount]),
    [["2026-09-07", 5], ["2026-09-08", 5]]
  );
  // Still on the books: the same as without `booked`.
  assert.deepEqual(lateFeesFor({ ...base, owed: 100, booked: { p: 50 } }), lateFeesFor({ ...base, owed: 100 }));
});
