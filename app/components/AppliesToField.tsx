"use client";

import { monthLabel } from "@/lib/rent-month";

/**
 * "Counts toward": which month a rent payment pays, whatever date it was
 * received. `value` "" means "the month it's dated in", and the select shows
 * that month until someone picks another.
 */
export default function AppliesToField({
  id,
  date,
  value,
  onChange,
  className,
  label = "Counts toward",
}: {
  id: string;
  /** The payment's date, YYYY-MM-DD. */
  date: string;
  value: string;
  onChange: (month: string) => void;
  className?: string;
  label?: string;
}) {
  const paidMonth = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";
  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value || paidMonth} onChange={(e) => onChange(e.target.value)}>
        {monthChoices(paidMonth, value).map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
            {m === paidMonth ? " (month paid)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The months on offer: three ahead of the month paid to a year behind it,
 * newest first, plus whatever is already chosen if it falls outside that.
 */
export function monthChoices(paidMonth: string, chosen: string): string[] {
  const base = paidMonth || new Date().toISOString().slice(0, 7);
  const [y, m] = base.split("-").map(Number);
  const out: string[] = [];
  for (let i = 3; i >= -12; i--) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  if (chosen && !out.includes(chosen)) out.push(chosen);
  return out.sort().reverse();
}
