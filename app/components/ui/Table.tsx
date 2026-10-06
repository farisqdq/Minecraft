"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ariaSort, nextSort, sortRows, type SortDir, type SortState, type SortValue } from "@/lib/sort-table";
import { IconArrowDown, IconArrowUp, IconChevronUpDown } from "../icons";
import styles from "./Table.module.css";

/**
 * Table styles + sorting. Markup stays plain <table> so each page keeps
 * control of its cells:
 *
 *   const { rows, sort, toggle } = useSort(data, { name: r => r.name, rent: r => r.rent }, { key: "name", dir: "asc" });
 *   <TableWrap>
 *     <table className={tableStyles.table}>
 *       <thead><tr>
 *         <SortHeader label="Property" col="name" sort={sort} onSort={toggle} />
 *         <SortHeader label="Rent" col="rent" sort={sort} onSort={toggle} numeric firstDir="desc" />
 *       </tr></thead>
 *       <tbody>{rows.map(r => <tr key={r.id}><td data-label="Property">…</td><td className={tableStyles.num} data-label="Rent">…</td></tr>)}</tbody>
 *     </table>
 *   </TableWrap>
 *
 * On a phone each row becomes a stacked card; `data-label` on a <td> is the
 * label shown beside its value there. Add `stack={false}` to TableWrap to
 * keep a real (horizontally scrolling) table instead.
 */
export const tableStyles = styles;

export function TableWrap({ children, stack = true }: { children: ReactNode; stack?: boolean }) {
  return <div className={`${styles.wrap} ${stack ? styles.stack : ""}`}>{children}</div>;
}

export function useSort<T, K extends string>(
  data: readonly T[],
  columns: Record<K, (row: T) => SortValue>,
  initial: SortState<NoInfer<K>>
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const rows = useMemo(() => sortRows(data, columns[sort.key], sort.dir), [data, columns, sort]);
  const toggle = (key: K, firstDir: SortDir = "asc") => setSort((s) => nextSort(s, key, firstDir));
  return { rows, sort, setSort, toggle };
}

export function SortHeader<K extends string>({
  label,
  col,
  sort,
  onSort,
  numeric = false,
  firstDir = numeric ? "desc" : "asc",
}: {
  label: string;
  col: K;
  sort: SortState<K>;
  onSort: (key: K, firstDir?: SortDir) => void;
  numeric?: boolean;
  firstDir?: SortDir;
}) {
  const on = sort.key === col;
  const Arrow = !on ? IconChevronUpDown : sort.dir === "asc" ? IconArrowUp : IconArrowDown;
  return (
    <th aria-sort={ariaSort(sort, col)} className={numeric ? styles.num : undefined} scope="col">
      <button type="button" className={`${styles.sortBtn} ${on ? styles.sorted : ""}`} onClick={() => onSort(col, firstDir)}>
        {label}
        <Arrow size={14} className={styles.sortIcon} />
      </button>
    </th>
  );
}
