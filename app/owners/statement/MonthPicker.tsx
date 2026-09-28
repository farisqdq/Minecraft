"use client";

import { useRouter } from "next/navigation";
import styles from "../owners.module.css";

/** Picks the statement month; the page re-renders with it in the URL, so the link can be shared. */
export default function MonthPicker({ months, value, labels }: { months: string[]; value: string; labels: string[] }) {
  const router = useRouter();
  return (
    <select
      className={styles.select}
      aria-label="Statement month"
      value={value}
      onChange={(e) => router.push(`/owners/statement?month=${e.target.value}`)}
    >
      {months.map((m, i) => (
        <option key={m} value={m}>
          {labels[i]}
        </option>
      ))}
    </select>
  );
}
