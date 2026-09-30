/**
 * The cash-flow chart and the KPI sparklines read a fixed twelve-month
 * window. For a portfolio that started logging five months ago, the first
 * seven columns are empty and the chart reads as "nothing happened" rather
 * than "nothing was recorded yet". These trim the window to where the
 * history actually begins.
 */

export type MonthPoint = { month: string; rent: number; expense: number };

const hasData = (p: MonthPoint) => Math.abs(p.rent) > 0.005 || Math.abs(p.expense) > 0.005;

/** The series from the first month with any income or expense on. Empty if none has. */
export function fromFirstData<T extends MonthPoint>(series: T[]): T[] {
  const first = series.findIndex(hasData);
  return first === -1 ? [] : series.slice(first);
}

/** How many months in the series have something recorded. */
export function monthsWithData(series: MonthPoint[]): number {
  return series.filter(hasData).length;
}

/** A trend needs two points: with fewer, a chart only pretends to show one. */
export function hasTrend(series: MonthPoint[]): boolean {
  return monthsWithData(series) >= 2;
}
