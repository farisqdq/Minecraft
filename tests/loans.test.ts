import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interestFor,
  splitPayment,
  currentBalance,
  payoff,
  isDue,
  missedMonths,
  nextUnpaidMonth,
  suggestPayment,
  yearTotals,
  balanceAt,
  dueDateOf,
  totalMonthly,
  parseLoanInput,
  parsePaymentInput,
  type LoanTerms,
  type LoanPaymentLike,
} from "../lib/loans.ts";

// The textbook case: $300,000 over 30 years at 6% is $1,798.65 a month.
const terms: LoanTerms = {
  balance: 300_000,
  balanceAsOf: "2026-01",
  rate: 6,
  payment: 1798.65,
  escrowTax: 250,
  escrowInsurance: 95.5,
  dueDay: 1,
};

const paid = (month: string, principal: number, interest = 0, escrow = 0): LoanPaymentLike => ({
  month,
  principal,
  interest,
  escrow,
});

test("the first payment of a textbook mortgage splits the way the lender's table does", () => {
  assert.equal(interestFor(300_000, 6), 1500);
  assert.deepEqual(splitPayment(300_000, 6, 1798.65), { interest: 1500, principal: 298.65 });
});

test("interest is rounded to the cent each month, not carried as a fraction", () => {
  // 123,456.78 × 6.125% / 12 = 630.1356…
  assert.equal(interestFor(123_456.78, 6.125), 630.14);
});

test("the last payment is only as large as what's left", () => {
  const split = splitPayment(500, 6, 1798.65);
  assert.equal(split.interest, 2.5);
  assert.equal(split.principal, 500, "never more principal than is owed");
});

test("a paid-off loan has nothing to split", () => {
  assert.deepEqual(splitPayment(0, 6, 1798.65), { interest: 0, principal: 0 });
});

test("extra principal comes off the balance on top of the scheduled amount", () => {
  assert.deepEqual(splitPayment(300_000, 6, 1798.65, 200), { interest: 1500, principal: 498.65 });
});

test("a zero-rate loan is all principal", () => {
  assert.deepEqual(splitPayment(12_000, 0, 500), { interest: 0, principal: 500 });
});

test("the balance is the opening figure less principal only — interest and escrow don't pay down a loan", () => {
  const payments = [paid("2026-01", 298.65, 1500, 345.5), paid("2026-02", 300.14, 1498.51, 345.5)];
  assert.equal(currentBalance(300_000, payments), 299_401.21);
});

test("three hundred and sixty payments leave only the rounding a lender trues up", () => {
  // $1,798.65 is the exact annuity ($1,798.6515…) rounded to the cent, so a
  // real loan ends with a dollar or two left that the final payment absorbs.
  // What must not happen is float drift: the remainder is a whole-cent
  // figure, and one more payment clears it to exactly zero.
  let interest = 0;
  const payments: LoanPaymentLike[] = [];
  for (let i = 0; i < 360; i++) {
    const s = splitPayment(currentBalance(300_000, payments), 6, 1798.65);
    interest += s.interest;
    payments.push(paid(`m${i}`, s.principal));
  }
  const left = currentBalance(300_000, payments);
  assert.ok(left > 0 && left < 2, `left ${left}`);
  assert.equal(Math.round(left * 100), left * 100, "a whole number of cents");
  payments.push(paid("last", splitPayment(left, 6, 1798.65).principal));
  assert.equal(currentBalance(300_000, payments), 0);
  // Amortization tables print $347,514.57 of interest.
  assert.ok(Math.abs(interest - 347_514.57) < 2, `total interest ${interest}`);
});

test("payoff projects the final month and the interest still to come", () => {
  const p = payoff(300_000, 6, 1798.65, "2026-01");
  assert.equal(p.payments, 360);
  assert.equal(p.month, "2055-12");
  assert.ok(Math.abs(p.interest - 347_514.57) < 1);
});

test("a payment that doesn't cover the interest never pays off", () => {
  assert.deepEqual(payoff(300_000, 6, 1500, "2026-01"), { month: null, payments: 0, interest: 0 });
  assert.deepEqual(payoff(0, 6, 1500, "2026-01"), { month: null, payments: 0, interest: 0 });
});

test("a payment is due each month from the start of the loan's books until it's recorded", () => {
  assert.equal(isDue(terms, [], "2025-12"), false, "before the books began");
  assert.equal(isDue(terms, [], "2026-01"), true);
  assert.equal(isDue(terms, [paid("2026-01", 298.65)], "2026-01"), false, "already recorded");
  assert.equal(isDue(terms, [], "2026-01", false), false, "a closed loan asks for nothing");
});

test("a paid-off loan stops asking, but the months before payoff still counted", () => {
  const small = { balance: 1000, balanceAsOf: "2026-01" };
  const payments = [paid("2026-01", 1000)];
  assert.equal(isDue(small, payments, "2026-02"), false);
  // A later payoff doesn't retroactively excuse an earlier month.
  assert.equal(isDue(small, [paid("2026-03", 1000)], "2026-02"), true);
});

test("missed months are the gaps between the start and a given month", () => {
  const payments = [paid("2026-01", 298.65), paid("2026-03", 301.64)];
  assert.deepEqual(missedMonths(terms, payments, "2026-04"), ["2026-02", "2026-04"]);
  assert.deepEqual(missedMonths(terms, payments, "2025-12"), []);
});

test("the next unpaid month skips over what's recorded", () => {
  assert.equal(nextUnpaidMonth(terms, []), "2026-01");
  assert.equal(nextUnpaidMonth(terms, [paid("2026-01", 1), paid("2026-02", 1)]), "2026-03");
});

test("the suggested split uses the balance left by earlier months only", () => {
  const payments = [paid("2026-01", 298.65, 1500)];
  const feb = suggestPayment(terms, payments, "2026-02");
  assert.equal(feb.balanceBefore, 299_701.35);
  assert.equal(feb.interest, 1498.51);
  assert.equal(feb.principal, 300.14);
  assert.equal(feb.escrowTax, 250);
  assert.equal(feb.escrowInsurance, 95.5);

  // Recording February after March doesn't let March's principal leak into
  // February's interest.
  const outOfOrder = suggestPayment(terms, [...payments, paid("2026-03", 301.64)], "2026-02");
  assert.equal(outOfOrder.balanceBefore, 299_701.35);
});

test("year totals keep the three kinds of money apart", () => {
  const payments = [
    paid("2025-12", 297.16, 1501.49, 345.5),
    paid("2026-01", 298.65, 1500, 345.5),
    paid("2026-02", 300.14, 1498.51, 345.5),
  ];
  assert.deepEqual(yearTotals(payments, 2026), { principal: 598.79, interest: 2998.51, escrow: 691, count: 2 });
});

test("the balance at a month counts payments through that month", () => {
  const payments = [paid("2026-01", 298.65), paid("2026-02", 300.14)];
  assert.equal(balanceAt(300_000, payments, "2026-01"), 299_701.35);
  assert.equal(balanceAt(300_000, payments, "2025-12"), 300_000);
});

test("the due date clamps to the end of a short month", () => {
  assert.equal(dueDateOf("2026-02", 31), "2026-02-28");
  assert.equal(dueDateOf("2028-02", 30), "2028-02-29");
  assert.equal(dueDateOf("2026-03", 1), "2026-03-01");
});

test("the monthly total is what leaves the bank", () => {
  assert.equal(totalMonthly(terms), 2144.15);
});

const form = {
  lender: "  Chase mortgage ",
  balance: "$300,000",
  balanceAsOf: "2026-01",
  rate: "6",
  payment: "1798.65",
  escrowTax: "250",
  escrowInsurance: "",
  dueDay: "1",
};

test("the loan form accepts figures as they're typed off a statement", () => {
  const r = parseLoanInput(form);
  assert.ok(r.ok);
  assert.equal(r.value.lender, "Chase mortgage");
  assert.equal(r.value.balance, 300_000);
  assert.equal(r.value.escrowInsurance, 0);
  assert.equal(r.value.note, null);
});

test("the loan form refuses a payment that can't cover the interest", () => {
  // The usual cause: the rate typed as a monthly figure, or the wrong box.
  const r = parseLoanInput({ ...form, rate: "72" });
  assert.equal(r.ok, false);
  const low = parseLoanInput({ ...form, payment: "1500" });
  assert.equal(low.ok, false);
  if (!low.ok) assert.match(low.error, /\$1500\.00/);
});

test("the loan form refuses the impossible", () => {
  assert.equal(parseLoanInput({ ...form, lender: " " }).ok, false);
  assert.equal(parseLoanInput({ ...form, balance: "0" }).ok, false);
  assert.equal(parseLoanInput({ ...form, balance: "1e309" }).ok, false);
  assert.equal(parseLoanInput({ ...form, balanceAsOf: "2026-13" }).ok, false);
  assert.equal(parseLoanInput({ ...form, dueDay: "32" }).ok, false);
  assert.equal(parseLoanInput({ ...form, escrowTax: "-5" }).ok, false);
  assert.equal(parseLoanInput(null).ok, false);
});

test("a payment with only a month takes the suggested split", () => {
  const r = parsePaymentInput({ month: "2026-01" }, terms, []);
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    month: "2026-01",
    date: "2026-01-01",
    principal: 298.65,
    interest: 1500,
    escrowTax: 250,
    escrowInsurance: 95.5,
  });
});

test("the lender's own split wins over the suggestion", () => {
  const r = parsePaymentInput(
    { month: "2026-01", interest: "1512.33", principal: "286.32", date: "2026-01-04" },
    terms,
    []
  );
  assert.ok(r.ok);
  assert.equal(r.value.interest, 1512.33);
  assert.equal(r.value.principal, 286.32);
  assert.equal(r.value.date, "2026-01-04");
});

test("a payment can't pay off more principal than was owed", () => {
  const r = parsePaymentInput({ month: "2026-01", principal: "300000.01" }, terms, []);
  assert.equal(r.ok, false);
});

test("a payment of nothing, or of negative money, is refused", () => {
  const zero = { month: "2026-01", principal: 0, interest: 0, escrowTax: 0, escrowInsurance: 0 };
  assert.equal(parsePaymentInput(zero, terms, []).ok, false);
  assert.equal(parsePaymentInput({ month: "2026-01", interest: "-1" }, terms, []).ok, false);
  assert.equal(parsePaymentInput({ month: "Jan" }, terms, []).ok, false);
});
