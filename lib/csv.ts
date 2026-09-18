// A leading one of these makes a spreadsheet treat the cell as a formula
// rather than text. Tab and carriage return are in the list because Excel
// skips them and looks at the next character.
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

// A field that is simply a number is left alone — neutralising it would turn
// every negative amount into text and break the sums an accountant runs.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Escapes one field for CSV, and defuses spreadsheet formula injection.
 *
 * The ledger's descriptions and notes are free text, and on a shared LLC they
 * may have been typed by a teammate. A note of `=HYPERLINK(...)` or an old
 * Excel DDE payload would run on whoever opens the export — usually the owner
 * or their accountant. Prefixing with an apostrophe makes the spreadsheet
 * read it as text; the apostrophe itself is not displayed.
 */
export function csvField(value: string | number): string {
  const s = String(value);
  const needsDefusing = typeof value === "string" && FORMULA_TRIGGERS.test(s) && !PLAIN_NUMBER.test(s);
  const body = needsDefusing ? `'${s}` : s;
  return needsDefusing || /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
}

export function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}
