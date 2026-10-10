/**
 * The overview's ledger, packed for the trip from server to browser.
 *
 * The overview hands every layout the whole ledger, and a portfolio a few
 * years old has thousands of entries. As objects, each one repeats a dozen
 * key names, a 25-character property id and a run of empty fields — about
 * 340 bytes an entry once it's escaped into the page, 3 MB for 15 buildings
 * over eight years, all of which the phone downloads and parses before the
 * page answers a tap.
 *
 * Packed, an entry is a short array: positions instead of key names, the
 * property and unit as an index into one list of each, an attachment's link
 * rebuilt from its id, and the trailing fields that hold their defaults
 * left off. `unpackLedger` gives back exactly the objects `packLedger` was
 * handed — the test pins that — so nothing that reads the ledger changes.
 *
 * Pure: no database, no React.
 */

export type LedgerAttachment = {
  id: string;
  transactionId: string;
  url: string;
  filename: string;
  contentType: string;
};

export type LedgerEntry = {
  id: string;
  propertyId: string;
  unitId: string | null;
  type: "rent" | "expense";
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  detail: string;
  note: string;
  category: string;
  appliesTo: string | null;
  spreadMonths: number | null;
  recurringExpenseId: string | null;
  loanPaymentId: string | null;
  attachments: LedgerAttachment[];
};

/** [id, filename, contentType] — the link and the entry's id are rebuilt. */
type PackedAttachment = [string, string, string];

/**
 * [id, property, unit, type, date, amount, detail, note, category, appliesTo,
 *  spreadMonths, recurringExpenseId, loanPaymentId, attachments]
 * with property and unit as indexes (unit −1 for none), type 0 rent / 1
 * expense, and every field after `amount` optional from the end.
 */
type PackedRow = [
  string,
  number,
  number,
  0 | 1,
  string,
  number,
  string?,
  string?,
  string?,
  (string | null)?,
  (number | null)?,
  (string | null)?,
  (string | null)?,
  PackedAttachment[]?,
];

export type PackedLedger = { v: 1; properties: string[]; units: string[]; rows: PackedRow[] };

/** Where a ledger attachment is served from; see lib/file-links. */
export type LinkFor = (attachmentId: string) => string;

export function packLedger(entries: LedgerEntry[]): PackedLedger {
  const properties: string[] = [];
  const units: string[] = [];
  const propertyAt = new Map<string, number>();
  const unitAt = new Map<string, number>();
  const indexOf = (list: string[], at: Map<string, number>, id: string) => {
    let i = at.get(id);
    if (i === undefined) {
      i = list.length;
      list.push(id);
      at.set(id, i);
    }
    return i;
  };

  const rows = entries.map((e) => {
    const row: PackedRow = [
      e.id,
      indexOf(properties, propertyAt, e.propertyId),
      e.unitId === null ? -1 : indexOf(units, unitAt, e.unitId),
      e.type === "rent" ? 0 : 1,
      e.date,
      e.amount,
      e.detail,
      e.note,
      e.category,
      e.appliesTo,
      e.spreadMonths,
      e.recurringExpenseId,
      e.loanPaymentId,
      e.attachments.map((a) => [a.id, a.filename, a.contentType] as PackedAttachment),
    ];
    // Drop trailing defaults: most entries end at the amount or the detail.
    const isDefault = (v: unknown, i: number) =>
      i === 13 ? (v as PackedAttachment[]).length === 0 : i >= 9 ? v === null : v === "";
    let end = row.length;
    while (end > 6 && isDefault(row[end - 1], end - 1)) end--;
    return row.slice(0, end) as PackedRow;
  });
  return { v: 1, properties, units, rows };
}

export function unpackLedger(packed: PackedLedger, linkFor: LinkFor): LedgerEntry[] {
  return packed.rows.map((r) => ({
    id: r[0],
    propertyId: packed.properties[r[1]],
    unitId: r[2] < 0 ? null : packed.units[r[2]],
    type: r[3] === 0 ? "rent" : "expense",
    date: r[4],
    amount: r[5],
    detail: r[6] ?? "",
    note: r[7] ?? "",
    category: r[8] ?? "",
    appliesTo: r[9] ?? null,
    spreadMonths: r[10] ?? null,
    recurringExpenseId: r[11] ?? null,
    loanPaymentId: r[12] ?? null,
    attachments: (r[13] ?? []).map(([id, filename, contentType]) => ({
      id,
      transactionId: r[0],
      url: linkFor(id),
      filename,
      contentType,
    })),
  }));
}
