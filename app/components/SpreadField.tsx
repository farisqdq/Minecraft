"use client";

import { MAX_SPREAD, spreadSummary } from "@/lib/spread";
import { monthLabel } from "@/lib/rent-month";
import { monthChoices } from "./AppliesToField";

/**
 * "Spread over several months": a yearly property-tax bill counted a twelfth
 * a month, or rent paid six months up front marking each month paid.
 * `months` 0 means not spread. `start` "" means the month of the date. For
 * rent the starting month is the form's own "Counts toward" field, so it's
 * only shown here for expenses.
 */
export default function SpreadField({
  idPrefix,
  type,
  date,
  amount,
  months,
  start,
  onMonths,
  onStart,
  fieldClass,
  wideClass,
  checkboxClass,
  noteClass,
}: {
  idPrefix: string;
  type: "rent" | "expense";
  date: string;
  amount: string;
  months: number;
  start: string;
  onMonths: (n: number) => void;
  onStart: (month: string) => void;
  fieldClass: string;
  wideClass: string;
  checkboxClass: string;
  noteClass: string;
}) {
  const on = months > 1;
  const paidMonth = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";
  const preview =
    on && Number(amount) > 0 && date
      ? spreadSummary({ type, date, amount: Number(amount), appliesTo: start || null, spreadMonths: months })
      : "";
  return (
    <>
      <label className={`${checkboxClass} ${wideClass}`}>
        <input type="checkbox" checked={on} onChange={(e) => onMonths(e.target.checked ? 12 : 0)} />
        {type === "rent" ? "Paid for several months at once" : "Spread over several months"}
      </label>
      {on && (
        <>
          <div className={fieldClass}>
            <label htmlFor={`${idPrefix}-spread`}>Number of months</label>
            <select id={`${idPrefix}-spread`} value={months} onChange={(e) => onMonths(Number(e.target.value))}>
              {Array.from({ length: MAX_SPREAD - 1 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n} months{n === 12 ? " (a year)" : ""}
                </option>
              ))}
            </select>
          </div>
          {type === "expense" && (
            <div className={fieldClass}>
              <label htmlFor={`${idPrefix}-spread-start`}>Starting</label>
              <select
                id={`${idPrefix}-spread-start`}
                value={start || paidMonth}
                onChange={(e) => onStart(e.target.value)}
              >
                {monthChoices(paidMonth, start).map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                    {m === paidMonth ? " (month paid)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {preview && <div className={`${noteClass} ${wideClass}`}>{preview}</div>}
        </>
      )}
    </>
  );
}
