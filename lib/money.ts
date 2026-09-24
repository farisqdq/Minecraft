const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * "$1,450" for a round figure, "$1,450.50" when the cents are real.
 *
 * Rents and most bills are whole dollars, and printing ".00" after every one
 * of them adds four characters of noise to every number on the page. Dropping
 * the cents outright would be worse — a $412.60 invoice would quietly read as
 * $413 — so the cents appear exactly when there are some.
 */
export function money(value: number) {
  return Number.isInteger(value) ? whole.format(value) : exact.format(value);
}

/** Always whole dollars — for axis ticks and chart totals, where cents are noise. */
export function moneyRound(value: number) {
  return whole.format(value);
}

/** Uses a real minus sign (−), not a hyphen, so negatives line up in tabular figures. */
export function signedMoney(value: number) {
  return `${value < 0 ? "−" : ""}${money(Math.abs(value))}`;
}

/**
 * The largest single amount any form accepts. Well past any real rent,
 * repair or deposit, and small enough that a typo like "1e309" (which
 * JavaScript reads as infinity) can't be stored and poison every total.
 */
export const MAX_AMOUNT = 10_000_000;

/** A payment, charge or bill amount: positive, finite, at most MAX_AMOUNT. */
export function validAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT;
}

/** A rent figure: zero (not let) or a valid amount. */
export function validRent(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT;
}
