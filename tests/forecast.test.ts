import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonth, forecast, otherSpending, type ForecastBill, type ForecastLoan } from "../lib/forecast.ts";

const places = [
  { propertyId: "oak", unitId: null, rent: 1450, vacant: false },
  { propertyId: "dup", unitId: "a", rent: 900, vacant: false },
  { propertyId: "dup", unitId: "b", rent: 950, vacant: true },
];
const tenants = [
  { name: "Alan", propertyId: "oak", unitId: null, leaseEnd: "2026-11-30", active: true },
  { name: "Maria", propertyId: "dup", unitId: "a", leaseEnd: "2027-08-31", active: true },
];
const base = { from: "2026-11", months: 12, places, tenants, rentChanges: [], bills: [] as ForecastBill[], loans: [] as ForecastLoan[], otherPerMonth: 0 };

test("months run across the year end", () => {
  assert.equal(addMonth("2026-11", 2), "2027-01");
  assert.deepEqual(forecast(base).months.map((m) => m.month).slice(0, 3), ["2026-11", "2026-12", "2027-01"]);
});

test("rent counts every let place, never a vacant one, and follows the rent history", () => {
  const raise = [
    { id: "a", propertyId: "oak", unitId: null, effectiveFrom: "1970-01", amount: 1450 },
    { id: "b", propertyId: "oak", unitId: null, effectiveFrom: "2027-01", amount: 1525 },
  ];
  const f = forecast({ ...base, rentChanges: raise });
  assert.equal(f.months[0].rent, 2350);
  assert.equal(f.months[2].rent, 2425);
});

test("rent past the end of every lease at a place is counted, and said to be at risk", () => {
  const f = forecast(base);
  // Alan's lease runs through November: December on is at risk.
  assert.equal(f.months[0].atRisk, 0);
  assert.equal(f.months[1].atRisk, 1450);
  // Maria's ends Aug 31, 2027: from September both are.
  assert.equal(f.months[10].atRisk, 2350);
  // A place with no tenant on file isn't at risk; it simply has no lease.
  const empty = forecast({ ...base, tenants: [] });
  assert.equal(empty.atRisk, 0);
});

test("yearly bills land in their month; monthly ones every month", () => {
  const bills: ForecastBill[] = [
    { propertyId: "oak", category: "Insurance", detail: "State Farm", amount: 118.5, frequency: "monthly", month: null, active: true },
    { propertyId: "oak", category: "Property Tax", detail: "", amount: 3200, frequency: "yearly", month: 12, active: true },
    { propertyId: "oak", category: "HOA / Condo Fees", detail: "", amount: 99, frequency: "monthly", month: null, active: false },
  ];
  const f = forecast({ ...base, bills });
  assert.equal(f.months[0].bills, 118.5);
  assert.equal(f.months[1].bills, 3318.5);
  assert.deepEqual(f.months[1].lines[0], { label: "Property Tax", amount: 3200 });
  // December is the low point, and its biggest line says why.
  assert.equal(f.lowest?.month, "2026-12");
});

test("a mortgage is paid every month from the first unpaid one until it's paid off", () => {
  const loan: ForecastLoan = {
    propertyId: "dup",
    lender: "Rocket",
    active: true,
    balance: 2500,
    balanceAsOf: "2026-10",
    rate: 6,
    payment: 1000,
    escrowTax: 100,
    escrowInsurance: 50,
    dueDay: 1,
    // October and November already paid; December is next.
    payments: [
      { month: "2026-10", principal: 987.5, interest: 12.5, escrow: 150 },
      { month: "2026-11", principal: 992.44, interest: 7.56, escrow: 150 },
    ],
  };
  const f = forecast({ ...base, loans: [loan] });
  assert.equal(f.months[0].mortgage, 0); // November: already paid
  // December pays off the $520.06 left: that, a month's interest on it
  // ($2.60) and the escrow — not a full payment.
  assert.equal(f.months[1].mortgage, 672.66);
  assert.equal(f.months[2].mortgage, 0); // paid off
  // A loan well away from payoff costs its full payment every month.
  const big = forecast({ ...base, loans: [{ ...loan, balance: 100000, payments: [] }] });
  assert.ok(big.months.every((m) => m.mortgage === 1150));
  // One whose payment only covers the interest still costs it, every month.
  const stuck = forecast({ ...base, loans: [{ ...loan, balance: 200000, payments: [] }] });
  assert.ok(stuck.months.every((m) => m.mortgage === 1150));
});

test("other spending is the average outside recurring bills and mortgage parts, over the months there are", () => {
  const e = (date: string, amount: number, over: object = {}) => ({ type: "expense" as const, date, amount, recurringExpenseId: null, loanPaymentId: null, ...over });
  const entries = [
    e("2026-08-03", 300),
    e("2026-09-10", 90),
    e("2026-09-12", 118.5, { recurringExpenseId: "ins" }),
    e("2026-09-01", 975, { loanPaymentId: "lp" }),
    e("2026-10-02", 500), // this month: not yet a full month
    { type: "rent" as const, date: "2026-08-01", amount: 1450, recurringExpenseId: null, loanPaymentId: null },
  ];
  // Books began in August: two full months (Aug, Sep), $390 between them.
  assert.deepEqual(otherSpending(entries, "2026-10"), { perMonth: 195, months: 2 });
  assert.deepEqual(otherSpending([], "2026-10"), { perMonth: 0, months: 0 });
  // A long history uses the last twelve months only.
  const old = [e("2024-01-05", 10000), e("2026-03-05", 1200)];
  assert.deepEqual(otherSpending(old, "2026-10"), { perMonth: 100, months: 12 });
});

test("totals add up to the months", () => {
  const f = forecast({ ...base, otherPerMonth: 195 });
  assert.equal(f.months[0].out, 195);
  assert.equal(f.net, Math.round(f.months.reduce((s, m) => s + m.net * 100, 0)) / 100);
  assert.equal(f.rent, 2350 * 12);
});
