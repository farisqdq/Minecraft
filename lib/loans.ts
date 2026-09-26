/**
 * Mortgages: what each payment really was.
 *
 * A mortgage payment is three different kinds of money wearing one number.
 * The interest is an expense. The escrow is property tax and insurance paid
 * on your behalf — also expenses, but under their own Schedule E lines. The
 * principal is not an expense at all: it is you buying back your own house,
 * and it comes back to you when you sell.
 *
 * Before loans existed here, the only way to record a mortgage was as one
 * recurring bill, and the form suggested filing it under "Mortgage Interest".
 * On a typical $1,850 payment that is several hundred dollars a month of
 * principal and escrow counted as interest — profit understated, and the
 * interest line on the tax export overstated by thousands a year, which is
 * the one number an accountant will check against the lender's Form 1098.
 *
 * So a loan is stored as the terms printed on a mortgage statement, and each
 * payment is split from the balance at the time: interest and escrow go into
 * the ledger under their own categories, principal only moves the balance.
 *
 * Everything here works in whole cents. Three hundred and sixty payments of
 * floating-point subtraction do not land on zero.
 *
 * Pure: no database and no clock.
 */

import { nextMonth } from "./balance.ts";
import { MAX_AMOUNT } from "./money.ts";

export type LoanTerms = {
  /** Principal owed at the start of `balanceAsOf`, before that month's payment. */
  balance: number;
  /** YYYY-MM: the first payment tracked here. */
  balanceAsOf: string;
  /** Annual interest rate as a percentage: 6.25 means 6.25%. */
  rate: number;
  /** The monthly principal-and-interest payment, without escrow. */
  payment: number;
  /** Monthly escrow toward property tax, and toward insurance. */
  escrowTax: number;
  escrowInsurance: number;
  /** Day of the month the payment is due, 1-31. */
  dueDay: number;
};

export type LoanPaymentLike = {
  /** YYYY-MM the payment was for. */
  month: string;
  principal: number;
  interest: number;
  escrow: number;
};

const toCents = (n: number) => Math.round(n * 100);
const toDollars = (c: number) => c / 100;

/** Longest schedule ever projected: a 50-year loan. Bounds a bad input. */
const MAX_MONTHS = 600;

/** One month's interest on a balance, to the cent. */
export function interestFor(balance: number, rate: number): number {
  return toDollars(Math.round((toCents(balance) * rate) / 1200));
}

/**
 * How one principal-and-interest payment divides at a given balance.
 *
 * Interest is charged first, the rest reduces principal — and never by more
 * than is owed, so the last payment of a loan is as small as it needs to be.
 * `extra` is additional principal sent with the payment.
 */
export function splitPayment(
  balance: number,
  rate: number,
  payment: number,
  extra = 0
): { interest: number; principal: number } {
  const owed = Math.max(0, toCents(balance));
  if (owed === 0) return { interest: 0, principal: 0 };
  const interest = toCents(interestFor(balance, rate));
  const principal = Math.min(owed, Math.max(0, toCents(payment) - interest) + Math.max(0, toCents(extra)));
  return { interest: toDollars(interest), principal: toDollars(principal) };
}

/** Principal still owed after the payments recorded so far. */
export function currentBalance(opening: number, payments: Pick<LoanPaymentLike, "principal">[]): number {
  const paid = payments.reduce((sum, p) => sum + toCents(p.principal), 0);
  return toDollars(Math.max(0, toCents(opening) - paid));
}

export function monthlyEscrow(terms: Pick<LoanTerms, "escrowTax" | "escrowInsurance">): number {
  return toDollars(toCents(terms.escrowTax) + toCents(terms.escrowInsurance));
}

/** Principal, interest and escrow — what actually leaves the bank account. */
export function totalMonthly(terms: Pick<LoanTerms, "payment" | "escrowTax" | "escrowInsurance">): number {
  return toDollars(toCents(terms.payment) + toCents(monthlyEscrow(terms)));
}

export type Payoff = {
  /** The month of the final payment, or null if the payment never gets there. */
  month: string | null;
  /** How many payments that is, counting from `from`. */
  payments: number;
  /** Interest still to be paid between now and then. */
  interest: number;
};

/**
 * When a balance is paid off at a fixed payment, starting with the payment
 * for `from`, and how much interest that costs on the way.
 *
 * A payment that doesn't cover the interest never pays anything off; that
 * comes back as `month: null` rather than a date six hundred months away.
 */
export function payoff(balance: number, rate: number, payment: number, from: string): Payoff {
  let owed = balance;
  let interest = 0;
  let month = from;
  if (toCents(owed) <= 0) return { month: null, payments: 0, interest: 0 };
  for (let n = 1; n <= MAX_MONTHS; n++) {
    const split = splitPayment(owed, rate, payment);
    if (split.principal <= 0) return { month: null, payments: 0, interest: 0 };
    interest = toDollars(toCents(interest) + toCents(split.interest));
    owed = toDollars(toCents(owed) - toCents(split.principal));
    // A payment quoted to the cent is a fraction of a cent off the exact
    // annuity, and over thirty years that leaves a dollar or two behind.
    // Lenders fold it into the final payment rather than bill a 361st, so
    // a remainder under 1% of a payment ends the loan here.
    if (toCents(owed) <= Math.max(0, Math.floor(toCents(payment) / 100))) return { month, payments: n, interest };
    month = nextMonth(month);
  }
  return { month: null, payments: 0, interest: 0 };
}

/** The next month with no payment recorded, starting from where the loan's books begin. */
export function nextUnpaidMonth(terms: Pick<LoanTerms, "balanceAsOf">, payments: Pick<LoanPaymentLike, "month">[]): string {
  const paid = new Set(payments.map((p) => p.month));
  let month = terms.balanceAsOf;
  for (let i = 0; i < MAX_MONTHS && paid.has(month); i++) month = nextMonth(month);
  return month;
}

/**
 * Whether a payment should be asked for in `month`: the loan is open, the
 * month is inside its books, something is still owed and nothing has been
 * recorded for it yet.
 */
export function isDue(
  terms: Pick<LoanTerms, "balance" | "balanceAsOf">,
  payments: LoanPaymentLike[],
  month: string,
  active = true
): boolean {
  if (!active || month < terms.balanceAsOf) return false;
  if (payments.some((p) => p.month === month)) return false;
  // Only payments before this month have reduced what's owed by then.
  return currentBalance(terms.balance, payments.filter((p) => p.month < month)) > 0;
}

/**
 * Months from the start of the loan's books through `through` that have no
 * payment recorded — the ones a landlord forgot to log.
 */
export function missedMonths(
  terms: Pick<LoanTerms, "balance" | "balanceAsOf">,
  payments: LoanPaymentLike[],
  through: string,
  active = true
): string[] {
  const out: string[] = [];
  if (!active) return out;
  let month = terms.balanceAsOf;
  for (let i = 0; i < MAX_MONTHS && month <= through; i++) {
    if (isDue(terms, payments, month, active)) out.push(month);
    month = nextMonth(month);
  }
  return out;
}

/**
 * The split to suggest for a month's payment: interest on what was owed
 * after every earlier payment, the rest to principal, escrow as set up.
 * The lender's statement wins over this whenever the two disagree, so the
 * form that uses it lets every figure be changed.
 */
export function suggestPayment(terms: LoanTerms, payments: LoanPaymentLike[], month: string) {
  const owed = currentBalance(terms.balance, payments.filter((p) => p.month < month));
  const split = splitPayment(owed, terms.rate, terms.payment);
  return {
    balanceBefore: owed,
    interest: split.interest,
    principal: split.principal,
    escrowTax: owed > 0 ? terms.escrowTax : 0,
    escrowInsurance: owed > 0 ? terms.escrowInsurance : 0,
  };
}

/** What went where over one calendar year — the figures to hold against the 1098. */
export function yearTotals(payments: LoanPaymentLike[], year: number) {
  const prefix = `${year}-`;
  let principal = 0;
  let interest = 0;
  let escrow = 0;
  let count = 0;
  for (const p of payments) {
    if (!p.month.startsWith(prefix)) continue;
    principal += toCents(p.principal);
    interest += toCents(p.interest);
    escrow += toCents(p.escrow);
    count += 1;
  }
  return { principal: toDollars(principal), interest: toDollars(interest), escrow: toDollars(escrow), count };
}

/** The balance after every payment for a month up to and including `through`. */
export function balanceAt(opening: number, payments: LoanPaymentLike[], through: string): number {
  return currentBalance(opening, payments.filter((p) => p.month <= through));
}

/** YYYY-MM-DD the payment for `month` is due, clamped to the month's last day. */
export function dueDateOf(month: string, dueDay: number): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Math.round(dueDay) || 1), last);
  return `${month}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Input

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function numberFrom(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value.replace(/[$,\s]/g, ""));
  return NaN;
}

export type LoanInput = LoanTerms & { lender: string; note: string | null };

/**
 * Checks the loan form. Every message names the figure on a mortgage
 * statement to look at, because that is where the right number is.
 */
export function parseLoanInput(body: unknown): { ok: true; value: LoanInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const lender = typeof b.lender === "string" ? b.lender.trim().slice(0, 120) : "";
  if (!lender) return { ok: false, error: "Name the lender, e.g. “Chase mortgage”." };

  const balance = numberFrom(b.balance);
  if (!Number.isFinite(balance) || balance <= 0 || balance > MAX_AMOUNT) {
    return { ok: false, error: "Enter the principal balance from your latest statement." };
  }
  const balanceAsOf = typeof b.balanceAsOf === "string" ? b.balanceAsOf : "";
  if (!MONTH_RE.test(balanceAsOf)) return { ok: false, error: "Pick the month of the next payment." };

  const rate = numberFrom(b.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) {
    return { ok: false, error: "Enter the interest rate as a percentage, like 6.25." };
  }
  const payment = numberFrom(b.payment);
  if (!Number.isFinite(payment) || payment <= 0 || payment > MAX_AMOUNT) {
    return { ok: false, error: "Enter the monthly principal and interest payment." };
  }
  const escrowTax = b.escrowTax === "" || b.escrowTax == null ? 0 : numberFrom(b.escrowTax);
  const escrowInsurance = b.escrowInsurance === "" || b.escrowInsurance == null ? 0 : numberFrom(b.escrowInsurance);
  for (const v of [escrowTax, escrowInsurance]) {
    if (!Number.isFinite(v) || v < 0 || v > MAX_AMOUNT) {
      return { ok: false, error: "Escrow amounts have to be zero or more." };
    }
  }
  const dueDay = Math.round(numberFrom(b.dueDay));
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) {
    return { ok: false, error: "The due day is a day of the month, 1 to 31." };
  }

  // The mistake this catches is typing the whole payment including escrow, or
  // an annual rate as a monthly one: either way the loan would never be paid.
  const firstInterest = interestFor(balance, rate);
  if (toCents(payment) <= toCents(firstInterest)) {
    return {
      ok: false,
      error: `At ${rate}% a month's interest on that balance is $${firstInterest.toFixed(2)}, so a $${payment.toFixed(
        2
      )} payment would never pay it down. Check the rate and the principal-and-interest figure.`,
    };
  }

  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  return {
    ok: true,
    value: { lender, balance, balanceAsOf, rate, payment, escrowTax, escrowInsurance, dueDay, note },
  };
}

export type PaymentInput = {
  month: string;
  date: string;
  principal: number;
  interest: number;
  escrowTax: number;
  escrowInsurance: number;
};

/**
 * Checks one recorded payment. Any figure left out is taken from the
 * suggested split, so "Log it" from the dashboard sends only a month.
 */
export function parsePaymentInput(
  body: unknown,
  terms: LoanTerms,
  payments: LoanPaymentLike[]
): { ok: true; value: PaymentInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const month = typeof b.month === "string" ? b.month : "";
  if (!MONTH_RE.test(month)) return { ok: false, error: "Missing month." };

  const suggested = suggestPayment(terms, payments, month);
  const pick = (key: string, fallback: number) => (b[key] === undefined || b[key] === "" ? fallback : numberFrom(b[key]));
  const principal = pick("principal", suggested.principal);
  const interest = pick("interest", suggested.interest);
  const escrowTax = pick("escrowTax", suggested.escrowTax);
  const escrowInsurance = pick("escrowInsurance", suggested.escrowInsurance);
  for (const v of [principal, interest, escrowTax, escrowInsurance]) {
    if (!Number.isFinite(v) || v < 0 || v > MAX_AMOUNT) {
      return { ok: false, error: "Each part of the payment has to be zero or more." };
    }
  }
  if (toCents(principal) + toCents(interest) + toCents(escrowTax) + toCents(escrowInsurance) <= 0) {
    return { ok: false, error: "That payment adds up to nothing." };
  }
  if (toCents(principal) > toCents(suggested.balanceBefore)) {
    return {
      ok: false,
      error: `Only $${suggested.balanceBefore.toFixed(2)} of principal was owed going into that month.`,
    };
  }

  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : dueDateOf(month, terms.dueDay);
  if (isNaN(new Date(date).getTime())) return { ok: false, error: "That date isn't valid." };

  return {
    ok: true,
    value: {
      month,
      date,
      principal: toDollars(toCents(principal)),
      interest: toDollars(toCents(interest)),
      escrowTax: toDollars(toCents(escrowTax)),
      escrowInsurance: toDollars(toCents(escrowInsurance)),
    },
  };
}
