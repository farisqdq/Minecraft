/**
 * Sorting for any table in the app, kept free of React so it can be tested.
 *
 * - Numbers sort numerically, strings with a natural, case-insensitive
 *   collation ("Unit 2" before "Unit 10"), dates by time.
 * - Empty values (null, undefined, "", NaN) always sink to the bottom,
 *   whichever way the column is sorted — a blank is never "the smallest".
 * - Stable: rows that compare equal keep their incoming order, so sorting by
 *   one column and then another behaves predictably.
 */
export type SortDir = "asc" | "desc";
export type SortValue = string | number | Date | boolean | null | undefined;
export type SortState<K extends string = string> = { key: K; dir: SortDir };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function isEmpty(v: SortValue): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v)) ||
    (v instanceof Date && Number.isNaN(v.getTime()));
}

/** Compare two present values ascending. Mixed types fall back to text. */
export function compareValues(a: SortValue, b: SortValue): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir = "asc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const ae = isEmpty(a.v);
      const be = isEmpty(b.v);
      if (ae || be) return ae === be ? a.index - b.index : ae ? 1 : -1;
      return sign * compareValues(a.v, b.v) || a.index - b.index;
    })
    .map((x) => x.row);
}

/**
 * The sort after a click on a column header: the same column flips
 * direction; a new column starts at its natural direction (`firstDir`,
 * e.g. "desc" for dates and amounts, where the biggest/newest is wanted).
 */
export function nextSort<K extends string>(current: SortState<K> | null, key: K, firstDir: SortDir = "asc"): SortState<K> {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: firstDir };
}

/** The aria-sort value for a header, so screen readers announce the order. */
export function ariaSort(current: SortState | null, key: string): "ascending" | "descending" | "none" {
  if (!current || current.key !== key) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}
