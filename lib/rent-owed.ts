/**
 * Rent owed, with late fees taken out — the figure a chase message states.
 *
 * A statement's balance is everything on the books: rent, lot fees, repairs,
 * credits and late fees, carried month to month. That's the right number for
 * "what's my account", and the wrong one for "$X is past due" in a reminder a
 * landlord may later copy into a 7-day pay-or-quit notice: in Kentucky the
 * notice amount must not include late fees. So the chase messages say rent
 * only, and mention any late fee in a separate sentence.
 *
 * The rule: rent owed = balance − the late fees still on the books for the
 * months being chased, never below zero. "The months being chased" are the
 * ones since the account was last square; a late fee from a month before
 * that was paid off along with everything else and is no longer part of the
 * balance, so taking it off again would understate the rent.
 *
 * Within the streak the statement doesn't say which dollars paid what, so
 * every late fee in it counts as unpaid. That can only make the rent figure
 * smaller, never larger — the safe side for a notice.
 *
 * Other charges (a lot fee, a repair) stay in: only late fees are excluded.
 *
 * Pure: no database, no formatting, so it's tested on its own. Relative
 * imports only, for the test runner.
 */

const cents = (n: number) => Math.round(n * 100) / 100;

/** The parts of a lib/statements.ts StatementResult this needs. */
export type RentOwedInput = {
  statement: { rows: { month: string; balance: number }[] };
  /** Late fees a late rule put on the books, by YYYY-MM. */
  lateFeesByMonth: Record<string, number>;
  /** Every charge on the books; hand-typed late fees are found by label. */
  charges?: { month: string; kind: string; label: string; amount: number; automatic: boolean }[];
};

export type RentOwed = {
  /** Rent owed, late fees excluded. Never negative. */
  rent: number;
  /** The late fees taken off to get there. */
  lateFees: number;
  /** The first month of the current run of unpaid rent, or "" when none is owed. */
  behindSince: string;
};

/**
 * Late fees per month: the ones a late rule made, plus any the landlord typed
 * in by hand and called a late fee ("Late fee — August"). A hand-typed one
 * isn't tied to a rule, so its label is the only thing that says what it is;
 * missing it would put it back in the rent figure.
 */
export function lateFeesPerMonth(input: RentOwedInput): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [month, amount] of Object.entries(input.lateFeesByMonth ?? {})) {
    if (amount > 0) out[month] = cents(amount);
  }
  for (const c of input.charges ?? []) {
    if (c.automatic || c.kind === "credit" || !/\blate\b/i.test(c.label)) continue;
    const amount = Math.max(0, c.amount || 0);
    if (amount > 0) out[c.month] = cents((out[c.month] ?? 0) + amount);
  }
  return out;
}

export function rentOwed(input: RentOwedInput): RentOwed {
  const fees = lateFeesPerMonth(input);
  const rows = input.statement.rows;

  // Walk the months in order, keeping the late fees added since the account
  // was last square. A square (or in-credit) month settles everything before
  // it, fees included, so the tally starts again after it.
  let feesInStreak = 0;
  const rentOnly: number[] = [];
  for (const r of rows) {
    feesInStreak = cents(feesInStreak + (fees[r.month] ?? 0));
    rentOnly.push(Math.max(0, cents(r.balance - feesInStreak)));
    if (r.balance <= 0.005) feesInStreak = 0;
  }

  const last = rows.length - 1;
  if (last < 0) return { rent: 0, lateFees: 0, behindSince: "" };
  const rent = rentOnly[last] > 0.005 ? rentOnly[last] : 0;

  // How far back the unpaid rent goes, the same way the statement works out
  // behindSince — but on the rent-only figure, so a month that owed nothing
  // but a late fee doesn't count as rent being behind.
  let behindSince = "";
  if (rent > 0) {
    for (let i = last; i >= 0 && rentOnly[i] > 0.005; i--) behindSince = rows[i].month;
  }

  return { rent, lateFees: Math.max(0, cents(rows[last].balance - rent)), behindSince };
}
