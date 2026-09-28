/**
 * The monthly owner statement as a PDF: one page per property when there
 * is more than one, then the combined figures. Pure — the numbers come in
 * already worked out by lib/owners.ts.
 */
import { TextDocument, type Column } from "./pdf-text.ts";
import { money } from "./money.ts";
import { monthName } from "./notices.ts";
import type { OwnerStatement } from "./owners.ts";

export type StatementPdfInput = {
  ownerName: string;
  month: string;
  /** "Sep 28, 2026" — the day it was produced. */
  producedOn: string;
  created?: Date;
  properties: { name: string; address: string; companyName: string; statement: OwnerStatement }[];
  combined: OwnerStatement;
};

const signed = (n: number) => `${n < 0 ? "-" : ""}${money(Math.abs(n))}`;

const COLS: Column[] = [{ flex: 1 }, { width: 110, align: "right" }];

function block(doc: TextDocument, heading: string, sub: string, s: OwnerStatement) {
  doc.gap(6).text(heading, { size: 14, bold: true });
  if (sub) doc.text(sub, { size: 10, grey: 0.45 });
  doc.gap(8);

  doc.row([{ text: "Income", bold: true, size: 10.5 }, { text: "", size: 10.5 }], COLS).rule({ grey: 0.7 });
  doc.row([{ text: "Rent collected" }, { text: money(s.rentCollected) }], COLS);
  if (s.otherIncome > 0) doc.row([{ text: "Other income (deposit kept)" }, { text: money(s.otherIncome) }], COLS);
  doc.row([{ text: "Total income", bold: true }, { text: money(s.totalIncome), bold: true }], COLS);

  doc.gap(10).row([{ text: "Expenses", bold: true, size: 10.5 }, { text: "", size: 10.5 }], COLS).rule({ grey: 0.7 });
  if (s.expenses.length === 0) doc.row([{ text: "No expenses recorded", grey: 0.45 }, { text: money(0) }], COLS);
  for (const e of s.expenses) doc.row([{ text: e.category }, { text: money(e.amount) }], COLS);
  doc.row([{ text: "Total expenses", bold: true }, { text: money(s.totalExpenses), bold: true }], COLS);

  doc.gap(10).rule({ weight: 1.2 });
  doc.row([{ text: "Net", bold: true, size: 13 }, { text: signed(s.net), bold: true, size: 13 }], COLS);
  if (s.entries === 0) {
    doc.text("Nothing was recorded for this month.", { size: 10, grey: 0.45 });
  }
}

export function ownerStatementPdf(input: StatementPdfInput): Uint8Array {
  const when = monthName(input.month);
  const doc = new TextDocument({ title: `Owner statement – ${when}`, created: input.created });
  doc.text("Owner statement", { size: 22, bold: true });
  doc.text(when, { size: 13 });
  doc.gap(4).text(`Prepared for ${input.ownerName} on ${input.producedOn}`, { size: 10, grey: 0.45 });
  doc.gap(10).rule();

  for (const p of input.properties) {
    block(doc, p.name, [p.address, p.companyName].filter(Boolean).join(" · "), p.statement);
    doc.gap(14);
  }
  if (input.properties.length > 1) {
    doc.gap(4).rule({ weight: 1.2 });
    block(doc, "All properties together", `${input.properties.length} properties`, input.combined);
  }

  doc.gap(18).text(
    "Figures are what the landlord has recorded for the month: rent and other income received, and expenses paid. Mortgage principal is not an expense and is not shown.",
    { size: 9, grey: 0.45 }
  );
  return doc.build();
}
