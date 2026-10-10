import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeReturns,
  irr,
  isDay,
  latestValuation,
  parsePurchaseInput,
  parseValuationInput,
  percent,
  portfolioReturns,
  type ReturnsEntry,
  type ReturnsInput,
  type ReturnsLoan,
} from "../lib/returns.ts";

const TODAY = "2026-10-10";

const base = (over: Partial<ReturnsInput> = {}): ReturnsInput => ({
  purchasePrice: null,
  purchasedOn: null,
  cashInvested: null,
  valuations: [],
  entries: [],
  loans: [],
  today: TODAY,
  ...over,
});

const rent = (date: string, amount: number, extra: Partial<ReturnsEntry> = {}): ReturnsEntry => ({
  type: "rent",
  date,
  amount,
  category: null,
  ...extra,
});
const expense = (date: string, amount: number, category: string, extra: Partial<ReturnsEntry> = {}): ReturnsEntry => ({
  type: "expense",
  date,
  amount,
  category,
  ...extra,
});

/** A month's rent and bills, every month from `from` for `n` months. */
function months(from: string, n: number, make: (month: string) => ReturnsEntry[]): ReturnsEntry[] {
  const out: ReturnsEntry[] = [];
  const [y, m] = from.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(...make(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`));
  }
  return out;
}

/* ---- IRR ---- */

test("irr: 10% a year, once a year, comes back as 10%", () => {
  // Monthly flows: −1000 now, +1100 twelve months later.
  const flows = Array(13).fill(0);
  flows[0] = -1000;
  flows[12] = 1100;
  assert.ok(Math.abs((irr(flows) as number) - 0.1) < 1e-6);
});

test("irr: losing money is a negative rate, and no sign change is no rate", () => {
  const flows = Array(13).fill(0);
  flows[0] = -1000;
  flows[12] = 800;
  assert.ok(Math.abs((irr(flows) as number) - -0.2) < 1e-6);
  assert.equal(irr([-1000, -5, -5]), null);
  assert.equal(irr([100, 5]), null);
  assert.equal(irr([-1000]), null);
});

/* ---- value, debt, equity ---- */

test("value is the latest valuation, falling back to the purchase price", () => {
  const bought = base({ purchasePrice: 200_000, purchasedOn: "2020-03-15" });
  const r0 = computeReturns(bought);
  assert.equal(r0.value, 200_000);
  assert.equal(r0.valueFrom, "purchase");
  assert.equal(r0.valueAsOf, "2020-03-15");

  const r1 = computeReturns({
    ...bought,
    valuations: [
      { id: "b", value: 260_000, asOf: "2025-06-01", source: "Appraisal", note: "" },
      { id: "a", value: 240_000, asOf: "2023-01-01", source: "", note: "" },
    ],
  });
  assert.equal(r1.value, 260_000);
  assert.equal(r1.valueFrom, "valuation");
  assert.equal(r1.appreciation, 60_000);
  // 200k → 260k over 5.2 years ≈ 5.18% a year.
  assert.ok(Math.abs((r1.appreciationRate as number) - 0.0518) < 0.001);
});

test("latestValuation takes the later date, and the later entry on a tie", () => {
  assert.equal(latestValuation([]), null);
  const v = [
    { asOf: "2025-01-01", n: 1 },
    { asOf: "2025-06-01", n: 2 },
    { asOf: "2025-06-01", n: 3 },
    { asOf: "2024-01-01", n: 4 },
  ];
  assert.equal(latestValuation(v)?.n, 3);
});

test("debt is what's owed on active loans after recorded principal; equity and LTV follow", () => {
  const loans: ReturnsLoan[] = [
    { balance: 150_000, active: true, payments: [{ month: "2026-09", date: "2026-09-01", principal: 300.55 }] },
    // Refinanced away: its balance isn't owed any more.
    { balance: 90_000, active: false, payments: [] },
  ];
  const r = computeReturns(
    base({ purchasePrice: 200_000, valuations: [{ id: "v", value: 250_000, asOf: "2026-01-01", source: "", note: "" }], loans })
  );
  assert.equal(r.debt, 149_699.45);
  assert.equal(r.equity, 100_300.55);
  assert.ok(Math.abs((r.ltv as number) - 149_699.45 / 250_000) < 1e-12);
});

test("nothing entered: no value, no equity, no rates — and it says what's missing", () => {
  const r = computeReturns(base({ entries: months("2025-01", 22, (m) => [rent(`${m}-01`, 1000)]) }));
  assert.equal(r.value, null);
  assert.equal(r.equity, null);
  assert.equal(r.capRate, null);
  assert.equal(r.cashOnCash, null);
  assert.equal(r.totalReturn, null);
  assert.equal(r.irr, null);
  assert.deepEqual(r.missing, ["price", "date", "cash", "value"]);
  // NOI still works without any of them.
  assert.equal(r.noi, 12_000);
});

/* ---- the last twelve months ---- */

test("NOI leaves out mortgage interest; cash flow takes out interest and principal", () => {
  const entries = months("2024-01", 34, (m) => [
    rent(`${m}-03`, 2000),
    expense(`${m}-05`, 150, "Insurance"),
    expense(`${m}-06`, 700, "Mortgage Interest"),
  ]);
  const loans: ReturnsLoan[] = [
    {
      balance: 180_000,
      active: true,
      payments: months("2024-01", 34, (m) => [rent(`${m}-06`, 0)]).map((e) => ({
        month: e.date.slice(0, 7),
        date: e.date,
        principal: 250,
      })),
    },
  ];
  const r = computeReturns(
    base({
      purchasePrice: 300_000,
      purchasedOn: "2024-01-01",
      cashInvested: 75_000,
      valuations: [{ id: "v", value: 320_000, asOf: "2026-06-01", source: "", note: "" }],
      entries,
      loans,
    })
  );
  assert.deepEqual(r.window, { from: "2025-11", to: "2026-10" });
  assert.equal(r.monthsInWindow, 12);
  assert.equal(r.annualized, false);
  assert.equal(r.income, 24_000);
  assert.equal(r.operating, 1_800);
  assert.equal(r.noi, 22_200);
  assert.equal(r.interest, 8_400);
  assert.equal(r.principal, 3_000);
  assert.equal(r.cashFlow, 10_800);
  assert.equal(r.annualNoi, 22_200);
  assert.ok(Math.abs((r.capRate as number) - 22_200 / 320_000) < 1e-12);
  assert.ok(Math.abs((r.cashOnCash as number) - 10_800 / 75_000) < 1e-12);
});

test("a spread entry counts only its months' shares in the window, like the property page", () => {
  // A $2,400 tax bill paid in Sep 2025, spread over 12 months from 2025-09:
  // Nov 2025 – Aug 2026 are in the window (10 × $200).
  const r = computeReturns(
    base({
      entries: [rent("2024-01-01", 1), expense("2025-09-15", 2400, "Property Tax", { appliesTo: "2025-09", spreadMonths: 12 })],
    })
  );
  assert.equal(r.operating, 2000);
});

test("rent that counts toward another month counts in that month", () => {
  // Paid Oct 30 2025 for November: inside the window, which starts in November.
  const r = computeReturns(base({ entries: [rent("2024-01-01", 1), rent("2025-10-30", 1000, { appliesTo: "2025-11" })] }));
  assert.equal(r.income, 1000);
});

test("a recent purchase is annualized from the months owned, and under three months shows no rate", () => {
  const entries = months("2026-05", 6, (m) => [rent(`${m}-01`, 1500), expense(`${m}-10`, 300, "Utilities")]);
  const r = computeReturns(
    base({ purchasePrice: 150_000, purchasedOn: "2026-05-01", cashInvested: 40_000, entries })
  );
  assert.equal(r.monthsInWindow, 6);
  assert.equal(r.annualized, true);
  assert.equal(r.noi, 7_200);
  assert.equal(r.annualNoi, 14_400);
  assert.ok(Math.abs((r.capRate as number) - 14_400 / 150_000) < 1e-12);
  assert.equal(r.irr, null, "under a year owned, no yearly rate");

  const fresh = computeReturns(
    base({ purchasePrice: 150_000, purchasedOn: "2026-09-20", cashInvested: 40_000, entries: [rent("2026-10-01", 1500)] })
  );
  assert.equal(fresh.monthsInWindow, 2);
  assert.equal(fresh.annualNoi, null);
  assert.equal(fresh.capRate, null);
  assert.equal(fresh.cashOnCash, null);
});

test("with no purchase date, the books' first month starts the window", () => {
  const entries = months("2026-07", 4, (m) => [rent(`${m}-01`, 1000)]);
  const r = computeReturns(base({ entries }));
  assert.equal(r.monthsInWindow, 4);
  assert.equal(r.annualNoi, 12_000);
});

/* ---- since the purchase ---- */

test("total return is cash flow to date plus equity over the cash put in", () => {
  // Bought for $200k with $50k down; owes $150k, paid down $6k of it.
  const entries = months("2024-10", 24, (m) => [rent(`${m}-01`, 1800), expense(`${m}-15`, 800, "Mortgage Interest")]);
  const loans: ReturnsLoan[] = [
    {
      balance: 150_000,
      active: true,
      payments: months("2024-10", 24, (m) => [rent(`${m}-15`, 0)]).map((e) => ({
        month: e.date.slice(0, 7),
        date: e.date,
        principal: 250,
      })),
    },
  ];
  const r = computeReturns(
    base({
      purchasePrice: 200_000,
      purchasedOn: "2024-10-01",
      cashInvested: 50_000,
      valuations: [{ id: "v", value: 220_000, asOf: "2026-09-01", source: "", note: "" }],
      entries,
      loans,
    })
  );
  // 24 months of entries, Oct 2024 through Sep 2026.
  assert.equal(r.since, "2024-10");
  assert.equal(r.principalToDate, 6_000);
  assert.equal(r.cashFlowToDate, 24 * (1800 - 800 - 250));
  assert.equal(r.debt, 144_000);
  assert.equal(r.equity, 76_000);
  assert.equal(r.totalReturn, 18_000 + 76_000 - 50_000);
  assert.ok(Math.abs((r.totalReturnPct as number) - 44_000 / 50_000) < 1e-12);
  // Held 24 months: an IRR exists and sits between 0 and the simple return.
  assert.ok(r.irr !== null && r.irr > 0.2 && r.irr < 0.88, `irr ${r.irr}`);
  assert.equal(r.booksStartLate, false);
});

test("IRR matches a hand-built schedule exactly", () => {
  // $10k in, $100 a month for 12 months, sold for $10k equity at month 12.
  const entries = months("2025-10", 12, (m) => [rent(`${m}-01`, 100)]);
  const r = computeReturns(
    base({
      purchasePrice: 10_000,
      purchasedOn: "2025-10-01",
      cashInvested: 10_000,
      valuations: [{ id: "v", value: 10_000, asOf: "2026-10-01", source: "", note: "" }],
      entries,
    })
  );
  // Cents by month: rent in months 0–11 (the first on the day it was
  // bought), none yet in month 12, which is when the equity is counted.
  const flows = Array(13).fill(10_000);
  flows[0] = 10_000 - 1_000_000;
  flows[12] = 1_000_000;
  assert.ok(Math.abs((r.irr as number) - (irr(flows) as number)) < 1e-9);
  // A little over 1% a month, since the first $100 comes at once: ≈12.8% a year.
  assert.ok(Math.abs((r.irr as number) - 0.1282) < 0.001);
});

test("books that start long after the purchase are flagged, and earlier entries fold into the first month", () => {
  const late = computeReturns(
    base({ purchasePrice: 100_000, purchasedOn: "2015-06-01", entries: [rent("2025-01-01", 900)] })
  );
  assert.equal(late.booksStartLate, true);
  const none = computeReturns(base({ purchasePrice: 100_000, purchasedOn: "2015-06-01" }));
  assert.equal(none.booksStartLate, true);
  const early = computeReturns(
    base({ purchasePrice: 100_000, purchasedOn: "2025-06-20", entries: [expense("2025-05-30", 500, "Legal & Professional")] })
  );
  assert.equal(early.booksStartLate, false);
  assert.equal(early.cashFlowToDate, -500);
});

test("entries dated after today don't count toward cash to date", () => {
  const r = computeReturns(base({ entries: [rent("2026-10-01", 1000), rent("2026-11-01", 1000)] }));
  assert.equal(r.cashFlowToDate, 1000);
});

/* ---- the portfolio ---- */

test("portfolio rates come from the sums, never an average of rates", () => {
  const big = computeReturns(
    base({
      purchasePrice: 900_000,
      cashInvested: 200_000,
      entries: months("2025-01", 22, (m) => [rent(`${m}-01`, 6000)]),
    })
  );
  const small = computeReturns(
    base({
      purchasePrice: 60_000,
      cashInvested: 60_000,
      entries: months("2025-01", 22, (m) => [rent(`${m}-01`, 1000)]),
    })
  );
  const unvalued = computeReturns(base({ entries: months("2025-01", 22, (m) => [rent(`${m}-01`, 500)]) }));
  const p = portfolioReturns([
    { returns: big, cashInvested: 200_000 },
    { returns: small, cashInvested: 60_000 },
    { returns: unvalued, cashInvested: null },
  ]);
  assert.equal(p.properties, 3);
  assert.equal(p.valued, 2);
  assert.equal(p.value, 960_000);
  assert.equal(p.annualNoi, 72_000 + 12_000 + 6_000);
  // The unvalued house's NOI stays out of the cap rate.
  assert.ok(Math.abs((p.capRate as number) - 84_000 / 960_000) < 1e-12);
  assert.ok(Math.abs((p.cashOnCash as number) - 84_000 / 260_000) < 1e-12);
  assert.equal(p.cashInvested, 260_000);
});

test("an empty portfolio has no rates", () => {
  const p = portfolioReturns([]);
  assert.equal(p.capRate, null);
  assert.equal(p.cashOnCash, null);
  assert.equal(p.ltv, null);
  assert.equal(p.totalReturn, null);
});

/* ---- input ---- */

test("purchase details: blanks are allowed, nonsense is not", () => {
  assert.deepEqual(parsePurchaseInput({ purchasePrice: "", purchasedOn: "", cashInvested: "" }, TODAY), {
    ok: true,
    value: { purchasePrice: null, purchasedOn: null, cashInvested: null },
  });
  assert.deepEqual(parsePurchaseInput({ purchasePrice: "$245,000", purchasedOn: "2019-04-12", cashInvested: "61,250.50" }, TODAY), {
    ok: true,
    value: { purchasePrice: 245_000, purchasedOn: "2019-04-12", cashInvested: 61_250.5 },
  });
  assert.equal(parsePurchaseInput({ purchasePrice: 0 }, TODAY).ok, false);
  assert.equal(parsePurchaseInput({ purchasePrice: "1e309" }, TODAY).ok, false);
  assert.equal(parsePurchaseInput({ purchasePrice: "abc" }, TODAY).ok, false);
  assert.equal(parsePurchaseInput({ purchasedOn: "2026-02-30" }, TODAY).ok, false);
  assert.equal(parsePurchaseInput({ purchasedOn: "2026-10-11" }, TODAY).ok, false, "not in the future");
  assert.equal(parsePurchaseInput({ cashInvested: -1 }, TODAY).ok, false);
  assert.equal(parsePurchaseInput({ cashInvested: 0 }, TODAY).ok, true, "all-financed is allowed");
});

test("valuations: a value and a day are required, and the day isn't in the future", () => {
  assert.deepEqual(parseValuationInput({ value: "310000", asOf: "2026-09-01", source: " Appraisal ", note: "" }, TODAY), {
    ok: true,
    value: { value: 310_000, asOf: "2026-09-01", source: "Appraisal", note: "" },
  });
  assert.equal(parseValuationInput({ value: "", asOf: "2026-09-01" }, TODAY).ok, false);
  assert.equal(parseValuationInput({ value: 1, asOf: "" }, TODAY).ok, false);
  assert.equal(parseValuationInput({ value: 1, asOf: "2027-01-01" }, TODAY).ok, false);
  assert.equal(parseValuationInput({ value: 2_000_000_000, asOf: "2026-01-01" }, TODAY).ok, false);
});

test("a backup's purchase and valuations survive the round trip through JSON and the parsers", () => {
  const purchase = { purchasePrice: 245_000, purchasedOn: "2019-04-12", cashInvested: 61_250.5 };
  const valuations = [
    { value: 300_000, asOf: "2024-02-01", source: "Appraisal", note: "Refi" },
    { value: 315_500.25, asOf: "2026-05-30", source: "", note: "" },
  ];
  const file = JSON.parse(JSON.stringify({ purchase, valuations }));
  assert.deepEqual(parsePurchaseInput(file.purchase, TODAY), { ok: true, value: purchase });
  assert.deepEqual(
    file.valuations.map((v: unknown) => parseValuationInput(v, TODAY)),
    valuations.map((value) => ({ ok: true, value }))
  );
  // A backup from before a31 has neither; that reads as "not entered".
  assert.deepEqual(parsePurchaseInput(undefined, TODAY), {
    ok: true,
    value: { purchasePrice: null, purchasedOn: null, cashInvested: null },
  });
});

/* ---- display ---- */

test("percent prints a real minus, and nothing for no rate", () => {
  assert.equal(percent(0.0625), "6.3%");
  assert.equal(percent(-0.031), "−3.1%");
  assert.equal(percent(-0.00001), "0.0%");
  assert.equal(percent(null), "—");
  assert.equal(percent(Infinity), "—");
  assert.equal(isDay("2024-02-29"), true);
  assert.equal(isDay("2023-02-29"), false);
});
