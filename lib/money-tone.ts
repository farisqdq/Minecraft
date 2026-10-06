/**
 * Which colour a money figure gets. Green and red carry meaning — "this went
 * up / this is owed" — so they belong only on signed figures (net, deltas,
 * balances). A zero, or anything that rounds to zero cents, is neutral: a red
 * "$0" reads as a problem when there isn't one.
 *
 * Plain totals ("Rent collected", "Expenses") shouldn't be toned at all;
 * don't pass them through this.
 */
export type MoneyTone = "pos" | "neg" | "zero";

/** Half a cent: anything smaller prints as $0.00 and must not look signed. */
export const ZERO_EPSILON = 0.005;

export function moneyTone(value: number, epsilon = ZERO_EPSILON): MoneyTone {
  if (!Number.isFinite(value) || Math.abs(value) < epsilon) return "zero";
  return value > 0 ? "pos" : "neg";
}

/**
 * For a figure where MORE is worse (money owed, a balance due): owing reads
 * red, a credit reads green, zero stays neutral.
 */
export function owedTone(value: number, epsilon = ZERO_EPSILON): MoneyTone {
  const t = moneyTone(value, epsilon);
  return t === "pos" ? "neg" : t === "neg" ? "pos" : "zero";
}

/**
 * Picks the class for a tone from a CSS module, e.g.
 * `toneClass(styles, moneyTone(net))` → styles.pos / styles.neg / styles.zero.
 */
export function toneClass(styles: Record<string, string>, tone: MoneyTone): string {
  return styles[tone] ?? "";
}
