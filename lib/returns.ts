/**
 * Is this place a good investment? The figures an owner, a lender or a buyer
 * asks for, worked out from what the app already knows plus three numbers
 * only the owner does: what they paid, when, and how much of their own cash
 * went in — and, from time to time, what the place is worth now.
 *
 *   Equity        value − what's still owed on the mortgages entered here.
 *   NOI           rent − operating expenses, over the last twelve months.
 *                 Mortgage interest is financing, not operating, so it's
 *                 left out; property tax and insurance (escrowed or not)
 *                 are in.
 *   Cap rate      NOI ÷ value. What the place earns as if bought for cash —
 *                 the number that compares one house with another.
 *   Cash flow     NOI − interest − principal: what was actually left after
 *                 the mortgage. The property page's "after principal" line.
 *   Cash-on-cash  cash flow ÷ cash invested. What the owner's own money is
 *                 earning, this year.
 *   Total return  every dollar of cash flow since the books began, plus the
 *                 equity gained over the cash put in: what selling today
 *                 would come to, before selling costs and tax.
 *   IRR           the same, as a yearly rate that respects when each dollar
 *                 moved — a dollar earned in the first year is worth more
 *                 than one earned last month.
 *
 * Twelve-month figures use the same months as the property page (the twelve
 * ending this month) and count each month's share of a spread entry
 * (lib/spread), so the two pages never disagree. Since-purchase figures go
 * by the date money moved, because that is what an investment return is.
 *
 * Only loans entered under Mortgages are debt. A refinance's cash-out isn't
 * in the ledger and so isn't in cash flow; the page says what it's built on.
 *
 * Pure: no database and no clock. Works in whole cents.
 */

import { allocate } from "./spread.ts";
import { currentBalance } from "./loans.ts";

/** Purchase prices and valuations: well past any house, short of a typo like 1e309. */
export const MAX_VALUE = 1_000_000_000;

/** Months of history before a twelve-month rate is shown at all. */
export const MIN_MONTHS_FOR_RATE = 3;

/** Months held before a yearly IRR means anything; sooner, it's noise times twelve. */
export const MIN_MONTHS_FOR_IRR = 12;

export const MORTGAGE_INTEREST = "Mortgage Interest";

/** Suggestions for where a value came from. Free text is fine too. */
export const VALUATION_SOURCES = [
  "Appraisal",
  "Broker's opinion",
  "Online estimate",
  "Tax assessment",
  "Comparable sales",
  "Purchase price",
] as const;

export type Purchase = {
  purchasePrice: number | null;
  /** YYYY-MM-DD */
  purchasedOn: string | null;
  cashInvested: number | null;
};

export type Valuation = {
  id: string;
  value: number;
  /** YYYY-MM-DD */
  asOf: string;
  source: string;
  note: string;
};

export type ReturnsEntry = {
  type: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  category: string | null;
  appliesTo?: string | null;
  spreadMonths?: number | null;
};

export type ReturnsLoan = {
  balance: number;
  active: boolean;
  payments: { month: string; date: string; principal: number }[];
};

export type ReturnsInput = Purchase & {
  valuations: Valuation[];
  entries: ReturnsEntry[];
  loans: ReturnsLoan[];
  /** YYYY-MM-DD, from the caller's idea of today. */
  today: string;
};

/** Why a figure can't be worked out, in the order the owner should fix them. */
export type Missing = "price" | "date" | "cash" | "value";

export type PropertyReturns = {
  /** The latest valuation, else the purchase price; null when neither is known. */
  value: number | null;
  valueAsOf: string | null;
  valueFrom: "valuation" | "purchase" | null;
  /** Principal still owed on the active mortgages entered here. */
  debt: number;
  equity: number | null;
  /** debt ÷ value, 0.62 for 62%. */
  ltv: number | null;

  /** The twelve-month window, YYYY-MM to YYYY-MM inclusive. */
  window: { from: string; to: string };
  /** How many of those months the place was owned (or on the books). */
  monthsInWindow: number;
  income: number;
  operating: number;
  noi: number;
  interest: number;
  principal: number;
  cashFlow: number;
  /** Scaled to a year when fewer than twelve months are known; null under three. */
  annualNoi: number | null;
  annualCashFlow: number | null;
  annualized: boolean;
  capRate: number | null;
  cashOnCash: number | null;

  /** First month counted in the since-purchase figures. */
  since: string | null;
  /** Rent − expenses − principal, every month since `since`, by the date money moved. */
  cashFlowToDate: number;
  principalToDate: number;
  appreciation: number | null;
  /** Compound yearly growth in value since purchase; null under a year. */
  appreciationRate: number | null;
  totalReturn: number | null;
  /** totalReturn ÷ cash invested. */
  totalReturnPct: number | null;
  irr: number | null;
  /** The month of the earliest ledger entry, if any. */
  booksFrom: string | null;
  /** The books start more than a month after the purchase: early cash flow is missing. */
  booksStartLate: boolean;
  missing: Missing[];
};

const toCents = (n: number) => Math.round(n * 100);
const toDollars = (c: number) => c / 100;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD — "2026-02-30" is not one. */
export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** "2026-09" + n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Whole months from `from` to `to`: 2026-01 → 2026-03 is 2. */
export function monthsApart(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** The value in force: the latest valuation by date (the later entry on a tie). */
export function latestValuation<T extends Pick<Valuation, "asOf">>(valuations: T[]): T | null {
  let best: T | null = null;
  for (const v of valuations) if (!best || v.asOf >= best.asOf) best = v;
  return best;
}

/**
 * The yearly rate at which a run of monthly cash flows nets to zero —
 * flows[0] is the first month, usually the money put in (negative).
 *
 * Solved by bisection on the monthly rate, which always converges and can't
 * wander off the way Newton's method does on lumpy real books. No sign
 * change (all money in, or all money out) has no rate, and says so: null.
 */
export function irr(flows: number[]): number | null {
  if (flows.length < 2) return null;
  const npv = (r: number) => {
    let sum = 0;
    let factor = 1;
    for (const f of flows) {
      sum += f / factor;
      factor *= 1 + r;
    }
    return sum;
  };
  let lo = -0.99;
  let hi = 1;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || hi - lo < 1e-12) {
      lo = hi = mid;
      break;
    }
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  const monthly = (lo + hi) / 2;
  return Math.pow(1 + monthly, 12) - 1;
}

export function computeReturns(input: ReturnsInput): PropertyReturns {
  const thisMonth = input.today.slice(0, 7);
  const purchaseMonth = input.purchasedOn ? input.purchasedOn.slice(0, 7) : null;

  // --- what it's worth, and what's owed against it
  const latest = latestValuation(input.valuations);
  const value = latest ? latest.value : input.purchasePrice;
  const valueAsOf = latest ? latest.asOf : input.purchasePrice !== null ? input.purchasedOn : null;
  const valueFrom = latest ? ("valuation" as const) : input.purchasePrice !== null ? ("purchase" as const) : null;
  const debtCents = input.loans
    .filter((l) => l.active)
    .reduce((sum, l) => sum + toCents(currentBalance(l.balance, l.payments)), 0);
  const debt = toDollars(debtCents);
  const equity = value !== null ? toDollars(toCents(value) - debtCents) : null;
  const ltv = value !== null && value > 0 ? debt / value : null;

  // --- the last twelve months, as the property page counts them
  const firstEntryMonth = input.entries.reduce<string | null>((first, e) => {
    const m = e.date.slice(0, 7);
    return first === null || m < first ? m : first;
  }, null);
  const windowFrom = shiftMonth(thisMonth, -11);
  // Months before the purchase (or, with no purchase date, before the books
  // begin) weren't earning anything for this owner; don't count them as zeros.
  const startedIn = purchaseMonth ?? firstEntryMonth ?? windowFrom;
  const effectiveFrom = startedIn > windowFrom ? startedIn : windowFrom;
  const monthsInWindow = effectiveFrom > thisMonth ? 0 : monthsApart(effectiveFrom, thisMonth) + 1;

  let income = 0;
  let operating = 0;
  let interest = 0;
  for (const e of input.entries) {
    for (const share of allocate(e)) {
      if (share.month < windowFrom || share.month > thisMonth) continue;
      const c = toCents(share.amount);
      if (e.type === "rent") income += c;
      else if (e.category === MORTGAGE_INTEREST) interest += c;
      else operating += c;
    }
  }
  let principal = 0;
  for (const l of input.loans) {
    for (const p of l.payments) {
      const m = p.date.slice(0, 7);
      if (m >= windowFrom && m <= thisMonth) principal += toCents(p.principal);
    }
  }
  const noi = income - operating;
  const cashFlow = noi - interest - principal;

  const enough = monthsInWindow >= MIN_MONTHS_FOR_RATE;
  const annualized = enough && monthsInWindow < 12;
  const scale = (c: number) => (annualized ? Math.round((c * 12) / monthsInWindow) : c);
  const annualNoi = enough ? toDollars(scale(noi)) : null;
  const annualCashFlow = enough ? toDollars(scale(cashFlow)) : null;
  const capRate = annualNoi !== null && value !== null && value > 0 ? annualNoi / value : null;
  const cashOnCash =
    annualCashFlow !== null && input.cashInvested !== null && input.cashInvested > 0
      ? annualCashFlow / input.cashInvested
      : null;

  // --- since the purchase, by the date money moved
  const since = purchaseMonth ?? firstEntryMonth;
  const monthly = new Map<string, number>();
  const add = (month: string, c: number) => {
    // Anything on the books from before the purchase lands in its first month.
    const m = since && month < since ? since : month;
    if (m > thisMonth) return;
    monthly.set(m, (monthly.get(m) ?? 0) + c);
  };
  let principalToDate = 0;
  for (const e of input.entries) {
    if (e.date > input.today) continue;
    add(e.date.slice(0, 7), e.type === "rent" ? toCents(e.amount) : -toCents(e.amount));
  }
  for (const l of input.loans) {
    for (const p of l.payments) {
      if (p.date > input.today) continue;
      principalToDate += toCents(p.principal);
      add(p.date.slice(0, 7), -toCents(p.principal));
    }
  }
  let cashFlowToDate = 0;
  for (const c of monthly.values()) cashFlowToDate += c;

  const price = input.purchasePrice;
  const appreciation = value !== null && price !== null && latest ? toDollars(toCents(value) - toCents(price)) : null;
  let appreciationRate: number | null = null;
  if (appreciation !== null && price !== null && price > 0 && input.purchasedOn && latest) {
    const years = (Date.parse(latest.asOf) - Date.parse(input.purchasedOn)) / (365.25 * 86_400_000);
    if (years >= 1) appreciationRate = Math.pow((value as number) / price, 1 / years) - 1;
  }

  const cash = input.cashInvested;
  const totalReturnCents =
    equity !== null && cash !== null ? cashFlowToDate + toCents(equity) - toCents(cash) : null;
  const totalReturn = totalReturnCents !== null ? toDollars(totalReturnCents) : null;
  const totalReturnPct = totalReturn !== null && cash !== null && cash > 0 ? totalReturn / cash : null;

  let rate: number | null = null;
  if (purchaseMonth && cash !== null && cash > 0 && equity !== null) {
    const held = monthsApart(purchaseMonth, thisMonth);
    if (held >= MIN_MONTHS_FOR_IRR) {
      const flows = Array.from({ length: held + 1 }, (_, i) => monthly.get(shiftMonth(purchaseMonth, i)) ?? 0);
      flows[0] -= toCents(cash);
      flows[held] += toCents(equity);
      rate = irr(flows);
    }
  }

  const booksStartLate =
    purchaseMonth !== null && (firstEntryMonth === null || monthsApart(purchaseMonth, firstEntryMonth) > 1);

  const missing: Missing[] = [];
  if (price === null) missing.push("price");
  if (!input.purchasedOn) missing.push("date");
  if (cash === null) missing.push("cash");
  if (!latest) missing.push("value");

  return {
    value,
    valueAsOf,
    valueFrom,
    debt,
    equity,
    ltv,
    window: { from: windowFrom, to: thisMonth },
    monthsInWindow,
    income: toDollars(income),
    operating: toDollars(operating),
    noi: toDollars(noi),
    interest: toDollars(interest),
    principal: toDollars(principal),
    cashFlow: toDollars(cashFlow),
    annualNoi,
    annualCashFlow,
    annualized,
    capRate,
    cashOnCash,
    since,
    cashFlowToDate: toDollars(cashFlowToDate),
    principalToDate: toDollars(principalToDate),
    appreciation,
    appreciationRate,
    totalReturn,
    totalReturnPct,
    irr: rate,
    booksFrom: firstEntryMonth,
    booksStartLate,
    missing,
  };
}

export type PortfolioReturns = {
  properties: number;
  /** How many have a value to count. */
  valued: number;
  value: number;
  debt: number;
  equity: number;
  ltv: number | null;
  annualNoi: number;
  annualCashFlow: number;
  capRate: number | null;
  cashOnCash: number | null;
  cashInvested: number;
  totalReturn: number | null;
};

/**
 * Many properties as one. Rates are recomputed from the sums — never an
 * average of rates, which would let a $60,000 condo count as much as a
 * $900,000 building — and each sum only takes properties that have both
 * halves of its fraction, so a house with no value entered can't drag the
 * cap rate toward zero.
 */
export function portfolioReturns(rows: { returns: PropertyReturns; cashInvested: number | null }[]): PortfolioReturns {
  let value = 0;
  let debtValued = 0;
  let debt = 0;
  let valued = 0;
  let noi = 0;
  let cf = 0;
  let capNoi = 0;
  let capValue = 0;
  let cocCf = 0;
  let cocCash = 0;
  let cashInvested = 0;
  let totalReturn = 0;
  let anyTotal = false;
  for (const { returns: r, cashInvested: cash } of rows) {
    debt += toCents(r.debt);
    if (r.value !== null) {
      valued += 1;
      value += toCents(r.value);
      debtValued += toCents(r.debt);
    }
    if (r.annualNoi !== null) noi += toCents(r.annualNoi);
    if (r.annualCashFlow !== null) cf += toCents(r.annualCashFlow);
    if (r.annualNoi !== null && r.value !== null && r.value > 0) {
      capNoi += toCents(r.annualNoi);
      capValue += toCents(r.value);
    }
    if (cash !== null && cash > 0) {
      cashInvested += toCents(cash);
      if (r.annualCashFlow !== null) {
        cocCf += toCents(r.annualCashFlow);
        cocCash += toCents(cash);
      }
    }
    if (r.totalReturn !== null) {
      anyTotal = true;
      totalReturn += toCents(r.totalReturn);
    }
  }
  return {
    properties: rows.length,
    valued,
    value: toDollars(value),
    debt: toDollars(debt),
    equity: toDollars(value - debtValued),
    ltv: value > 0 ? debtValued / value : null,
    annualNoi: toDollars(noi),
    annualCashFlow: toDollars(cf),
    capRate: capValue > 0 ? capNoi / capValue : null,
    cashOnCash: cocCash > 0 ? cocCf / cocCash : null,
    cashInvested: toDollars(cashInvested),
    totalReturn: anyTotal ? toDollars(totalReturn) : null,
  };
}

/* ---- input ---- */

function amount(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.replace(/[$,\s]/g, "") : "x";
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The purchase details as typed. Every field may be left blank — an owner
 * who knows the price but not the closing costs should still get a cap rate —
 * but what is typed has to make sense.
 */
export function parsePurchaseInput(body: unknown, today: string): Parsed<Purchase> {
  const b = (body ?? {}) as Record<string, unknown>;
  const purchasePrice = amount(b.purchasePrice);
  if (purchasePrice === undefined || (purchasePrice !== null && (purchasePrice <= 0 || purchasePrice > MAX_VALUE))) {
    return { ok: false, error: "Enter what you paid for it, or leave it blank." };
  }
  const rawDay = typeof b.purchasedOn === "string" ? b.purchasedOn.trim() : b.purchasedOn ?? null;
  let purchasedOn: string | null = null;
  if (rawDay !== null && rawDay !== "") {
    if (!isDay(rawDay)) return { ok: false, error: "Pick the day you bought it, or leave it blank." };
    if (rawDay > today) return { ok: false, error: "The purchase date can't be in the future." };
    purchasedOn = rawDay;
  }
  const cashInvested = amount(b.cashInvested);
  if (cashInvested === undefined || (cashInvested !== null && (cashInvested < 0 || cashInvested > MAX_VALUE))) {
    return { ok: false, error: "Enter the cash you put in, or leave it blank." };
  }
  return { ok: true, value: { purchasePrice, purchasedOn, cashInvested } };
}

export type ValuationInput = Omit<Valuation, "id">;

export function parseValuationInput(body: unknown, today: string): Parsed<ValuationInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const value = amount(b.value);
  if (value === undefined || value === null || value <= 0 || value > MAX_VALUE) {
    return { ok: false, error: "Enter what the place is worth." };
  }
  const asOf = typeof b.asOf === "string" ? b.asOf.trim() : "";
  if (!isDay(asOf)) return { ok: false, error: "Pick the day this value is from." };
  if (asOf > today) return { ok: false, error: "A value can't be from the future." };
  const source = typeof b.source === "string" ? b.source.trim().slice(0, 80) : "";
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
  return { ok: true, value: { value, asOf, source, note } };
}

/* ---- display ---- */

/** "6.2%", "−3.1%"; null as an em dash. */
export function percent(rate: number | null, digits = 1): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  const text = (Math.abs(rate) * 100).toFixed(digits);
  return `${rate < 0 && Number(text) !== 0 ? "−" : ""}${text}%`;
}

export const MISSING_LABEL: Record<Missing, string> = {
  price: "purchase price",
  date: "purchase date",
  cash: "cash invested",
  value: "current value",
};
