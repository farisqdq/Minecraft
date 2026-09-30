/**
 * When a stat tile's trend line and "vs last month" change mean something.
 * Pure, shared by every layout's tiles.
 */

/** Months with anything in them (a zero is an empty month, not a data point). */
const hasValue = (v: number) => Math.abs(v) >= 0.005;

/**
 * A trend line needs at least 3 months with data. With one real month the
 * line is flat at zero and then leaps to a dot, which reads as a spike.
 */
export function hasTrend(points: number[], minMonths = 3): boolean {
  return points.filter(hasValue).length >= minMonths;
}

/**
 * Whether a change against the previous period can be shown. An empty
 * previous period (nothing recorded) isn't a baseline — "↑ $37,112 vs Aug"
 * when August had nothing is noise — so the tile says "No data for Aug".
 */
export function comparable(prior: number | undefined, priorPeriodEmpty = false): boolean {
  return prior !== undefined && !priorPeriodEmpty && hasValue(prior);
}
