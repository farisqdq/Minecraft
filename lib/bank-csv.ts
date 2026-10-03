/**
 * Reading the CSV a bank exports.
 *
 * Every bank writes a different file. Chase puts "Details" (DEBIT/CREDIT)
 * before the date and signs the amount; Bank of America opens with a summary
 * block and a "Beginning balance" line before the real header; Wells Fargo
 * writes no header at all; Capital One splits money in and out into Debit and
 * Credit columns, both positive. A landlord shouldn't have to know which of
 * these they have, so this finds the header (or works without one), picks the
 * date, description and amount columns by name and then by content, and
 * reads US dates and amounts in the forms banks actually print.
 *
 * Everything comes out as one shape: a day, a signed amount — positive is
 * money in — and the bank's own words.
 *
 * Pure: no database, no DOM, no clock.
 */

export type BankRow = {
  /** 1-based line in the file, so a problem can be pointed at. */
  line: number;
  /** YYYY-MM-DD. */
  date: string;
  /** Signed, in dollars: positive is money in, negative is money out. */
  amount: number;
  /** The bank's description, with any memo column joined on. */
  text: string;
};

export type ColumnMap = {
  date: number;
  /** One or more columns read together as the description. */
  text: number[];
  /** A single signed amount column… */
  amount: number | null;
  /** …or separate money-out and money-in columns. */
  debit: number | null;
  credit: number | null;
  /** A column saying DEBIT/CREDIT, for files whose amounts are all positive. */
  sign: number | null;
};

export type DateOrder = "mdy" | "dmy";

export type Statement = {
  rows: BankRow[];
  /** The header as written, or generated names ("Column 1") when there is none. */
  header: string[];
  hasHeader: boolean;
  /** The first few lines under the header, as cells — for choosing columns by eye. */
  sample: string[][];
  columns: ColumnMap | null;
  dateOrder: DateOrder;
  /** Lines that looked like data but couldn't be read, and why. */
  skipped: { line: number; reason: string }[];
  /** Set when nothing usable was found. */
  error?: string;
};

/** More than a few years of any one account; a larger file is the wrong file. */
export const MAX_ROWS = 5000;

/**
 * Splits CSV text into rows of fields. Handles quoted fields with embedded
 * commas, quotes ("") and newlines, CRLF or LF endings, a leading byte-order
 * mark, and semicolon or tab delimiters when the file uses those instead.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field.trim() === "") {
      field = "";
      quoted = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r" || c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim()));
}

/** The delimiter the first few lines use most, outside quotes. Comma unless clearly not. */
function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  const count = (d: string) => {
    let n = 0;
    let quoted = false;
    for (const c of sample) {
      if (c === '"') quoted = !quoted;
      else if (!quoted && c === d) n += 1;
    }
    return n;
  };
  const comma = count(",");
  const semi = count(";");
  const tab = count("\t");
  if (tab > comma && tab >= semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function validYmd(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function fullYear(y: number, raw: string): number {
  if (raw.length > 2) return y;
  // Two-digit years: everything a bank would export is this century.
  return 2000 + y;
}

/**
 * A bank's date as YYYY-MM-DD, or null. Reads 09/03/2026, 9/3/26, 2026-09-03,
 * 20260903, "Sep 3, 2026" and "03 Sep 2026". Slashed dates are month-first
 * unless `order` says the file is day-first; a time after the date is ignored.
 */
export function parseDate(raw: string, order: DateOrder = "mdy"): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, "").replace(/T.*$/, "");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = fullYear(+m[3], m[3]);
    return order === "dmy" ? validYmd(y, +m[2], +m[1]) : validYmd(y, +m[1], +m[2]);
  }
  const month = (name: string) => MONTHS[name.slice(0, 3).toLowerCase()];
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/.exec(s);
  if (m && month(m[1])) return validYmd(fullYear(+m[3], m[3]), month(m[1]), +m[2]);
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{2}|\d{4})$/.exec(s);
  if (m && month(m[2])) return validYmd(fullYear(+m[3], m[3]), month(m[2]), +m[1]);
  return null;
}

/**
 * A bank's amount in dollars, signed, rounded to the cent; null when the
 * field is empty or isn't a number. Reads "$1,234.56", "-1234.56",
 * "($1,234.56)" and "1,234.56-" as negative, "+12" and "12.00 CR" as
 * positive, "12.00 DR" as negative.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  const crdr = /\s*(CR|DR)$/i.exec(s);
  if (crdr) {
    negative = crdr[1].toUpperCase() === "DR";
    s = s.slice(0, crdr.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^(USD|US\$|\$)\s*/i, "").replace(/\s*USD$/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return (negative ? -cents : cents) / 100;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z#]+/g, " ").trim();

/** Header names, best first, for each role. */
const DATE_NAMES = ["date", "transaction date", "trans date", "posting date", "posted date", "post date", "effective date", "value date"];
const TEXT_NAMES = ["description", "payee", "name", "merchant", "transaction description", "original description", "details", "narrative"];
const MEMO_NAMES = ["memo", "extended description", "additional info", "notes", "note", "reference"];
const AMOUNT_NAMES = ["amount", "transaction amount", "amount usd", "net amount"];
const DEBIT_NAMES = ["debit", "debits", "withdrawal", "withdrawals", "withdrawal amount", "debit amount", "money out", "paid out", "out", "payments", "charges"];
const CREDIT_NAMES = ["credit", "credits", "deposit", "deposits", "deposit amount", "credit amount", "money in", "paid in", "in", "receipts"];
const SIGN_NAMES = ["transaction type", "type", "details", "credit debit indicator", "dr cr", "cr dr"];

function findColumn(header: string[], names: string[], taken: Set<number>): number | null {
  const h = header.map(norm);
  for (const name of names) {
    const i = h.findIndex((v, idx) => !taken.has(idx) && v === name);
    if (i >= 0) return i;
  }
  return null;
}

/** Whether a row reads like a header: a date-ish name and a money-ish name, no dates or amounts in it. */
function looksLikeHeader(row: string[]): boolean {
  const h = row.map(norm);
  const hasDate = h.some((v) => DATE_NAMES.includes(v) || /\bdate\b/.test(v));
  const hasMoney = h.some(
    (v) => AMOUNT_NAMES.includes(v) || DEBIT_NAMES.includes(v) || CREDIT_NAMES.includes(v) || /\bamount\b/.test(v)
  );
  const hasData = row.some((f) => parseDate(f) !== null || (parseAmount(f) !== null && /\d/.test(f)));
  return hasDate && hasMoney && !hasData;
}

/** Day-first if any slashed date in the column has a first number over 12. */
function sniffDateOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/.exec(v.trim());
    if (m && +m[1] > 12 && +m[2] <= 12) return "dmy";
  }
  return "mdy";
}

/**
 * Picks the columns from a header, falling back to what the data looks like
 * for anything the names don't settle.
 */
export function detectColumns(header: string[] | null, data: string[][]): ColumnMap | null {
  const width = Math.max(header?.length ?? 0, ...data.slice(0, 50).map((r) => r.length));
  const sample = data.slice(0, 200);
  const share = (col: number, test: (v: string) => boolean) => {
    const vals = sample.map((r) => r[col] ?? "").filter((v) => v !== "");
    if (vals.length === 0) return 0;
    return vals.filter(test).length / vals.length;
  };
  const isDate = (v: string) => parseDate(v, "mdy") !== null || parseDate(v, "dmy") !== null;
  const isAmount = (v: string) => parseAmount(v) !== null;

  const taken = new Set<number>();
  let date: number | null = null;
  let amount: number | null = null;
  let debit: number | null = null;
  let credit: number | null = null;
  let sign: number | null = null;
  const text: number[] = [];

  if (header) {
    date = findColumn(header, DATE_NAMES, taken);
    if (date === null) {
      const i = header.map(norm).findIndex((v) => /\bdate\b/.test(v));
      date = i >= 0 ? i : null;
    }
    if (date !== null) taken.add(date);
    amount = findColumn(header, AMOUNT_NAMES, taken);
    if (amount !== null) taken.add(amount);
    else {
      debit = findColumn(header, DEBIT_NAMES, taken);
      if (debit !== null) taken.add(debit);
      credit = findColumn(header, CREDIT_NAMES, taken);
      if (credit !== null) taken.add(credit);
      if (debit === null || credit === null) {
        // One of the pair alone isn't enough to sign anything.
        if (debit !== null) taken.delete(debit);
        if (credit !== null) taken.delete(credit);
        debit = credit = null;
        const i = header.map(norm).findIndex((v, idx) => !taken.has(idx) && /\bamount\b/.test(v) && !/balance/.test(v));
        amount = i >= 0 ? i : null;
        if (amount !== null) taken.add(amount);
      }
    }
    const desc = findColumn(header, TEXT_NAMES, taken);
    // "Details" on a Chase export is DEBIT/CREDIT, not a description: only
    // take it when it actually holds words.
    if (desc !== null && share(desc, (v) => /^(debit|credit|check|dslip|dep|ach)$/i.test(v)) < 0.5) {
      text.push(desc);
      taken.add(desc);
    }
    const memo = findColumn(header, MEMO_NAMES, taken);
    if (memo !== null) {
      text.push(memo);
      taken.add(memo);
    }
    if (amount !== null) {
      const s = findColumn(header, SIGN_NAMES, taken);
      if (s !== null && share(s, (v) => /debit|credit|^dr$|^cr$|withdraw|deposit/i.test(v)) >= 0.8) sign = s;
    }
  }

  // Whatever the names didn't settle, decide from the data.
  if (date === null) {
    let best = -1;
    let bestShare = 0.8;
    for (let c = 0; c < width; c++) {
      if (taken.has(c)) continue;
      const s = share(c, isDate);
      if (s > bestShare) {
        best = c;
        bestShare = s;
      }
    }
    if (best >= 0) {
      date = best;
      taken.add(best);
    }
  }
  if (amount === null && (debit === null || credit === null)) {
    for (let c = 0; c < width; c++) {
      if (taken.has(c)) continue;
      // A column of signed figures with a non-numeric neighbour is the
      // amount; a running balance comes after it, so the first one wins.
      if (share(c, (v) => isAmount(v) && /\d/.test(v)) >= 0.9 && share(c, isDate) < 0.5) {
        amount = c;
        taken.add(c);
        break;
      }
    }
  }
  if (text.length === 0) {
    // The column with the most letters in it.
    let best = -1;
    let bestLetters = 0;
    for (let c = 0; c < width; c++) {
      if (taken.has(c)) continue;
      const letters = sample.reduce((n, r) => n + ((r[c] ?? "").match(/[A-Za-z]/g)?.length ?? 0), 0);
      if (letters > bestLetters) {
        best = c;
        bestLetters = letters;
      }
    }
    if (best >= 0) text.push(best);
  }

  if (date === null || text.length === 0 || (amount === null && (debit === null || credit === null))) return null;
  return { date, text, amount, debit, credit, sign };
}

/** Lines a bank writes among the transactions that aren't transactions. */
const NOT_A_TRANSACTION = /^(beginning|ending|opening|closing|starting) balance|^total\b|^balance (forward|brought)/i;

/**
 * Reads a whole export. `columns` and `flip` override what was detected —
 * the import screen offers both when the guess is wrong. `flip` is for card
 * statements that print charges as positive.
 */
export function readStatement(
  input: string,
  opts: { columns?: ColumnMap; flip?: boolean; dateOrder?: DateOrder } = {}
): Statement {
  const all = parseCsv(input);
  // Line numbers survive the blank lines being dropped.
  const numbered = all
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter((r) => r.cells.some((c) => c !== ""));
  const headerAt = numbered.findIndex((r) => looksLikeHeader(r.cells));
  const hasHeader = headerAt >= 0;
  const header = hasHeader ? numbered[headerAt].cells : [];
  const body = hasHeader ? numbered.slice(headerAt + 1) : numbered;
  const width = Math.max(header.length, ...body.slice(0, 50).map((r) => r.cells.length), 0);
  const names = hasHeader ? header : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);

  const columns = opts.columns ?? detectColumns(hasHeader ? header : null, body.map((r) => r.cells));
  const sample = body.slice(0, 4).map((r) => r.cells);
  const base = { header: names, hasHeader, sample, columns, skipped: [] as Statement["skipped"] };
  if (!columns) {
    return {
      ...base,
      rows: [],
      dateOrder: "mdy",
      error: "Couldn't find a date, a description and an amount in this file. Is it the CSV export of a bank or card account?",
    };
  }
  const dateOrder = opts.dateOrder ?? sniffDateOrder(body.map((r) => r.cells[columns.date] ?? ""));
  const rows: BankRow[] = [];
  const skipped: Statement["skipped"] = [];

  for (const { cells, line } of body) {
    const text = columns.text
      .map((c) => (cells[c] ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((v, i, list) => list.indexOf(v) === i)
      .join(" · ");
    if (NOT_A_TRANSACTION.test(text)) continue;
    const date = parseDate(cells[columns.date] ?? "", dateOrder);
    let amount: number | null;
    if (columns.amount !== null) {
      amount = parseAmount(cells[columns.amount] ?? "");
      if (amount !== null && columns.sign !== null) {
        const s = (cells[columns.sign] ?? "").toLowerCase();
        if (/debit|^dr$|withdraw/.test(s)) amount = -Math.abs(amount);
        else if (/credit|^cr$|deposit/.test(s)) amount = Math.abs(amount);
      }
    } else {
      const out = parseAmount(cells[columns.debit!] ?? "");
      const inn = parseAmount(cells[columns.credit!] ?? "");
      amount = inn !== null && inn !== 0 ? Math.abs(inn) : out !== null && out !== 0 ? -Math.abs(out) : null;
    }
    if (!date) {
      skipped.push({ line, reason: `No date we can read ("${(cells[columns.date] ?? "").slice(0, 30)}")` });
      continue;
    }
    if (amount === null || amount === 0) {
      // A pending row, a memo line or a zero-dollar notice: nothing to book.
      skipped.push({ line, reason: "No amount" });
      continue;
    }
    if (opts.flip) amount = -amount;
    if (rows.length >= MAX_ROWS) {
      return { ...base, rows, dateOrder, skipped, error: `Only the first ${MAX_ROWS} transactions are read. Export a shorter date range.` };
    }
    rows.push({ line, date, amount, text: text.slice(0, 300) || "(no description)" });
  }
  if (rows.length === 0) {
    return { ...base, rows, dateOrder, skipped, error: "No transactions found in this file." };
  }
  return { ...base, rows, dateOrder, skipped };
}

/** FNV-1a, 32-bit, from a seed — two of them make a short id that won't collide in one landlord's books. */
function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A stable id for each line, the same however many times the file — or an
 * overlapping export from the same account — is uploaded. Two identical
 * lines on one day (two $25 fees) are told apart by their order among
 * themselves, which a re-export keeps.
 */
export function withRefs<T extends BankRow>(rows: T[]): (T & { ref: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const cents = Math.round(r.amount * 100);
    const text = r.text.toUpperCase().replace(/\s+/g, " ").trim();
    const base = `${r.date}|${cents}|${text}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...r, ref: `${r.date}:${cents}:${fnv(text, 0x811c9dc5)}${fnv(text, 0x050c5d1f)}:${n}` };
  });
}

/** What a ref looks like, so the server can refuse anything else. */
export const REF_PATTERN = /^\d{4}-\d{2}-\d{2}:-?\d{1,12}:[0-9a-f]{16}:\d{1,5}$/;
