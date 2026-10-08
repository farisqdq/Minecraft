/**
 * Tax-year view of the ledger, for the tax export.
 *
 * Unspread entries count in the year of the date they were paid (an
 * "applies to" month on rent does not move it). A spread entry counts by
 * its monthly shares: whatever falls in the tax year is that year's amount,
 * so a bill paid in January and spread over July–June puts half in each
 * year. A spread entry becomes ONE line per year, with a note saying so.
 *
 * Pure, so the export and the tests share it.
 */
import { allocate, isSpread, type Spreadable } from "./spread.ts";

export type TaxLine<T> = Omit<T, "amount" | "note"> & {
  amount: number;
  note: string | null;
  /** YYYY-MM-DD the line is dated in the export. */
  day: string;
};

const dayOf = (d: string | Date) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

export function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * The entries as they count in `year`. Order: as given for unspread
 * entries; spread lines are slotted in by their date (stable).
 */
export function taxYearLines<T extends Spreadable & { note?: string | null }>(txns: readonly T[], year: number): TaxLine<T>[] {
  const prefix = `${year}-`;
  const out: TaxLine<T>[] = [];
  let anySpread = false;
  for (const t of txns) {
    if (!isSpread(t)) {
      const day = dayOf(t.date);
      if (day.startsWith(prefix)) out.push({ ...t, amount: t.amount, note: t.note ?? null, day });
      continue;
    }
    anySpread = true;
    const all = allocate(t);
    const mine = all.filter((p) => p.month.startsWith(prefix));
    if (mine.length === 0) continue;
    const total = mine.reduce((s, p) => s + cents(p.amount), 0) / 100;
    const each = usd(all[0].amount);
    const spreadNote =
      mine.length === all.length
        ? `${all.length}-month spread, all in ${year} (${each}/mo)`
        : `${all.length}-month spread, ${mine.length} month${mine.length === 1 ? "" : "s"} in ${year} (${each}/mo)`;
    const paid = dayOf(t.date);
    const day = paid.startsWith(prefix) ? paid : `${mine[0].month}-01`;
    out.push({ ...t, amount: total, note: t.note ? `${t.note} · ${spreadNote}` : spreadNote, day });
  }
  if (anySpread) out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return out;
}
