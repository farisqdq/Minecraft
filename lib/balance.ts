/**
 * What a tenant owes, carried across months.
 *
 * The app could already answer "did they pay September?". It could not answer
 * "what do they owe me?", which is the question a portfolio actually turns
 * on: someone $300 short in July and $1,450 short in August showed as two
 * unrelated unpaid months rather than one $1,750 hole.
 *
 * Rent is not stored anywhere. It is derived per month from the rent history,
 * which already knows what a place cost in each month and already handles a
 * raise mid-lease. Storing rent rows as well would mean two sources for one
 * number and a backfill for every tenant already on the books. Only the
 * things rent can't tell you — a late fee, a lot fee, a credit — are rows.
 *
 * Nothing here touches a database or formats money, so the arithmetic can be
 * tested on its own.
 */

export type ChargeKind = "fee" | "credit";

export type ChargeInput = {
  month: string;
  kind: ChargeKind;
  amount: number;
  label: string;
};

export type PaymentInput = {
  /** The month the payment landed in, by its date — not the month it's "for". */
  month: string;
  amount: number;
};

export type StatementRow = {
  month: string;
  rent: number;
  fees: number;
  credits: number;
  paid: number;
  /** What's owed at the end of this month. Negative means they're in credit. */
  balance: number;
};

export type Statement = {
  rows: StatementRow[];
  /** Positive: they owe you. Negative: you owe them. */
  balance: number;
  /** The month the debt started and never cleared, or "" if square. */
  behindSince: string;
  /** How many months that is, counting the current one. */
  monthsBehind: number;
  charged: number;
  received: number;
};

/** Money, to the cent. Floats accumulate error over twelve additions. */
const cents = (n: number) => Math.round(n * 100) / 100;

/** "2026-09" + 1 → "2026-10" */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every month from `from` to `to`, inclusive. Empty if `from` is later. */
export function monthsBetween(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return [];
  if (from > to) return [];
  const out: string[] = [];
  let m = from;
  // A guard rather than a while(true): a bad input should give a short wrong
  // answer, not hang the request.
  for (let i = 0; i < 1200 && m <= to; i++) {
    out.push(m);
    m = nextMonth(m);
  }
  return out;
}

/**
 * Which month to start charging rent from — the single most dangerous number
 * here.
 *
 * Leases in this app go back years; the ledger usually doesn't. Charging rent
 * from the lease start would invent arrears for every month before the books
 * began and tell a landlord that a tenant who has never missed a payment owes
 * tens of thousands. So:
 *
 *   1. Whatever the landlord set, if they set anything.
 *   2. Otherwise the first month money actually came in, because that is the
 *      first month we have any evidence about — but never before this tenant
 *      moved in. Payments are recorded against a unit, not a person, so the
 *      first payment on file may well be the previous tenant's, and crediting
 *      it to this one would hand them someone else's money.
 *   3. Otherwise this month — with no payments and no instruction, the honest
 *      assumption about the past is that it was settled, not that it wasn't.
 *
 * The landlord can always say "start in January, they owed me $1,750 then"
 * with balanceFrom and openingBalance. What the app must never do is guess
 * that number upwards on its own.
 */
export function resolveStartMonth(opts: {
  explicit?: string | null;
  firstPaymentMonth?: string | null;
  /** The month this tenancy began, when it's on file. */
  leaseStartMonth?: string | null;
  currentMonth: string;
}): string {
  const { explicit, firstPaymentMonth, leaseStartMonth, currentMonth } = opts;
  if (explicit && /^\d{4}-\d{2}$/.test(explicit)) return explicit;
  const inferred =
    firstPaymentMonth && /^\d{4}-\d{2}$/.test(firstPaymentMonth) ? firstPaymentMonth : currentMonth;
  // Later of the two: the lease pushes the start forward, never back. Pulling
  // it back is what resolveStartMonth exists to refuse.
  if (leaseStartMonth && /^\d{4}-\d{2}$/.test(leaseStartMonth) && leaseStartMonth > inferred) {
    // …but not past today, which would leave a current tenant with no rows.
    return leaseStartMonth < currentMonth ? leaseStartMonth : currentMonth;
  }
  return inferred;
}

export function buildStatement(opts: {
  startMonth: string;
  currentMonth: string;
  openingBalance?: number;
  /** Expected rent for a month; 0 when vacant or not yet let. */
  rentFor: (month: string) => number;
  /** Last month rent is charged for — a move-out stops the meter. */
  lastRentMonth?: string | null;
  charges?: ChargeInput[];
  payments?: PaymentInput[];
  /**
   * Anything the standing rules add once the month's rent, charges and
   * payments are in — in practice a late fee, which can only be decided after
   * you know what is still outstanding. Called once per month, in order, and
   * whatever comes back lands in that same month.
   */
  assess?: (month: string, owed: number, rentThisMonth: number) => ChargeInput[];
}): Statement {
  const {
    startMonth,
    currentMonth,
    openingBalance = 0,
    rentFor,
    lastRentMonth,
    charges = [],
    payments = [],
    assess,
  } = opts;

  // A tenancy that has ended stops here, and so does the statement. Rent is
  // keyed to a property and a unit, not to a person, so a statement that ran
  // on past the move-out would go on crediting the *next* tenant's payments
  // to the one who left — a tenant three years gone read as $13,300 in
  // credit before this line existed.
  const lastMonth =
    lastRentMonth && /^\d{4}-\d{2}$/.test(lastRentMonth) && lastRentMonth < currentMonth
      ? lastRentMonth
      : currentMonth;
  const months = monthsBetween(startMonth, lastMonth);
  let running = cents(openingBalance);
  let charged = cents(openingBalance);
  let received = 0;
  const rows: StatementRow[] = [];

  for (const month of months) {
    const rent = lastRentMonth && month > lastRentMonth ? 0 : Math.max(0, rentFor(month) || 0);

    let fees = 0;
    let credits = 0;
    for (const c of charges) {
      if (c.month !== month) continue;
      const amount = Math.max(0, c.amount || 0);
      if (c.kind === "credit") credits += amount;
      else fees += amount;
    }

    let paid = 0;
    for (const p of payments) {
      if (p.month === month) paid += Math.max(0, p.amount || 0);
    }

    // What they'd owe with nothing else added. A late fee is assessed
    // against exactly this, so paying in full before the grace period runs
    // out means there is nothing to charge a fee on.
    let owed = cents(running + rent + fees - credits - paid);

    if (assess) {
      for (const extra of assess(month, owed, rent)) {
        const amount = Math.max(0, extra.amount || 0);
        if (!(amount > 0.005)) continue;
        if (extra.kind === "credit") {
          credits += amount;
          owed = cents(owed - amount);
        } else {
          fees += amount;
          owed = cents(owed + amount);
        }
      }
    }

    running = owed;
    charged = cents(charged + rent + fees);
    received = cents(received + paid + credits);
    rows.push({
      month,
      rent: cents(rent),
      fees: cents(fees),
      credits: cents(credits),
      paid: cents(paid),
      balance: running,
    });
  }

  // How far back the current debt runs: walk backwards while it stays owed.
  // A month where they were square breaks the streak, because a debt that
  // cleared and came back started again when it came back.
  let behindSince = "";
  let monthsBehind = 0;
  if (running > 0.005) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].balance > 0.005) {
        behindSince = rows[i].month;
        monthsBehind += 1;
      } else break;
    }
  }

  return { rows, balance: running, behindSince, monthsBehind, charged, received };
}

/** "$1,750 behind since July" — the one line a card needs. */
export function balanceSummary(s: Statement, monthLabel: (m: string) => string): string {
  if (s.balance > 0.005) {
    const since = s.behindSince ? ` since ${monthLabel(s.behindSince)}` : "";
    return `behind${since}`;
  }
  if (s.balance < -0.005) return "in credit";
  return "paid up";
}
