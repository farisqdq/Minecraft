import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseCsv, parseDate, readStatement, withRefs, REF_PATTERN } from "../lib/bank-csv.ts";

test("CSV fields: quotes, embedded commas and quotes, CRLF, a byte-order mark", () => {
  const rows = parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n');
  assert.deepEqual(rows, [
    ["a", "b, c", 'say "hi"'],
    ["1", "2", "3"],
  ]);
});

test("a quoted field may run over a line break", () => {
  assert.deepEqual(parseCsv('x,"two\nlines",y\n'), [["x", "two\nlines", "y"]]);
});

test("semicolon and tab files are read as such", () => {
  assert.deepEqual(parseCsv("Date;Amount\n09/01/2026;12,00\n")[1], ["09/01/2026", "12,00"]);
  assert.deepEqual(parseCsv("Date\tAmount\n09/01/2026\t12\n")[1], ["09/01/2026", "12"]);
});

test("dates in the forms banks print", () => {
  assert.equal(parseDate("09/03/2026"), "2026-09-03");
  assert.equal(parseDate("9/3/26"), "2026-09-03");
  assert.equal(parseDate("2026-09-03"), "2026-09-03");
  assert.equal(parseDate("20260903"), "2026-09-03");
  assert.equal(parseDate("Sep 3, 2026"), "2026-09-03");
  assert.equal(parseDate("September 3 2026"), "2026-09-03");
  assert.equal(parseDate("03 Sep 2026"), "2026-09-03");
  assert.equal(parseDate("03-Sep-26"), "2026-09-03");
  assert.equal(parseDate("09/03/2026 14:22:05"), "2026-09-03");
  assert.equal(parseDate("03/09/2026", "dmy"), "2026-09-03");
});

test("impossible dates are refused, not rolled over", () => {
  assert.equal(parseDate("02/30/2026"), null);
  assert.equal(parseDate("13/01/2026"), null);
  assert.equal(parseDate("Pending"), null);
  assert.equal(parseDate(""), null);
});

test("amounts: currency signs, thousands, parentheses, trailing minus, CR/DR", () => {
  assert.equal(parseAmount("$1,450.00"), 1450);
  assert.equal(parseAmount("-1,450.00"), -1450);
  assert.equal(parseAmount("-$85.12"), -85.12);
  assert.equal(parseAmount("$-85.12"), -85.12);
  assert.equal(parseAmount("($85.12)"), -85.12);
  assert.equal(parseAmount("85.12-"), -85.12);
  assert.equal(parseAmount("+12"), 12);
  assert.equal(parseAmount("12.00 CR"), 12);
  assert.equal(parseAmount("12.00 DR"), -12);
  assert.equal(parseAmount("0.1"), 0.1);
  // Floating-point noise is rounded to the cent.
  assert.equal(parseAmount("19.999"), 20);
});

test("anything that isn't a figure is not an amount", () => {
  for (const s of ["", "N/A", "1,23", "12.5.1", "abc", "1e5"]) assert.equal(parseAmount(s), null, s);
});

test("Chase checking: Details is DEBIT/CREDIT, Description is the words, Balance is ignored", () => {
  const csv = [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,",
    'CREDIT,09/02/2026,"ZELLE PAYMENT FROM ALAN WARD 8KD8F2",1450.00,QUICKPAY_CREDIT,6450.00,,',
    "DEBIT,09/05/2026,LG&E WEB PYMT 093026,-212.40,ACH_DEBIT,6237.60,,",
  ].join("\n");
  const s = readStatement(csv);
  assert.equal(s.error, undefined);
  assert.equal(s.hasHeader, true);
  assert.deepEqual(
    s.rows.map((r) => [r.date, r.amount, r.text]),
    [
      ["2026-09-02", 1450, "ZELLE PAYMENT FROM ALAN WARD 8KD8F2"],
      ["2026-09-05", -212.4, "LG&E WEB PYMT 093026"],
    ]
  );
});

test("Bank of America: a summary block before the header, and balance lines that aren't transactions", () => {
  const csv = [
    "Description,,Summary Amt.",
    'Beginning balance as of 09/01/2026,,"5,000.00"',
    'Total credits,,"1,450.00"',
    "",
    "Date,Description,Amount,Running Bal.",
    '09/01/2026,Beginning balance as of 09/01/2026,,"5,000.00"',
    '09/03/2026,"Mobile Deposit Ref 4471","1,450.00","6,450.00"',
    '09/04/2026,"HOME DEPOT #2318 LEXINGTON KY","-84.17","6,365.83"',
  ].join("\n");
  const s = readStatement(csv);
  assert.equal(s.error, undefined);
  assert.deepEqual(
    s.rows.map((r) => [r.line, r.date, r.amount]),
    [
      [7, "2026-09-03", 1450],
      [8, "2026-09-04", -84.17],
    ]
  );
});

test("Wells Fargo: no header at all — columns found from what's in them", () => {
  const csv = [
    '"09/02/2026","1450.00","*","","ZELLE FROM ALAN WARD ON 09/02 REF # PP0K8"',
    '"09/05/2026","-212.40","*","","LG&E WEB PYMT"',
  ].join("\n");
  const s = readStatement(csv);
  assert.equal(s.error, undefined);
  assert.equal(s.hasHeader, false);
  assert.deepEqual(s.header, ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5"]);
  assert.deepEqual(
    s.rows.map((r) => [r.date, r.amount, r.text]),
    [
      ["2026-09-02", 1450, "ZELLE FROM ALAN WARD ON 09/02 REF # PP0K8"],
      ["2026-09-05", -212.4, "LG&E WEB PYMT"],
    ]
  );
});

test("Capital One: separate Debit and Credit columns, both positive", () => {
  const csv = [
    "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
    "2026-09-04,2026-09-05,1234,HOME DEPOT 2318,Merchandise,84.17,",
    "2026-09-10,2026-09-10,1234,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,500.00",
  ].join("\n");
  const s = readStatement(csv);
  assert.equal(s.error, undefined);
  assert.deepEqual(
    s.rows.map((r) => [r.date, r.amount, r.text]),
    [
      ["2026-09-04", -84.17, "HOME DEPOT 2318"],
      ["2026-09-10", 500, "CAPITAL ONE AUTOPAY PYMT"],
    ]
  );
});

test("all-positive amounts signed by a Type column", () => {
  const csv = ["Date,Description,Amount,Transaction Type", "09/02/2026,RENT ALAN WARD,1450.00,Credit", "09/05/2026,LG&E,212.40,Debit"].join("\n");
  assert.deepEqual(
    readStatement(csv).rows.map((r) => r.amount),
    [1450, -212.4]
  );
});

test("a memo column is read along with the description", () => {
  const csv = ["Date,Description,Memo,Amount", "09/02/2026,ZELLE PAYMENT,Alan Ward - Sept rent,1450"].join("\n");
  assert.equal(readStatement(csv).rows[0].text, "ZELLE PAYMENT · Alan Ward - Sept rent");
});

test("flip turns a card statement's positive charges into money out", () => {
  const csv = ["Date,Description,Amount", "09/04/2026,HOME DEPOT,84.17"].join("\n");
  assert.equal(readStatement(csv, { flip: true }).rows[0].amount, -84.17);
});

test("day-first dates are recognised from a day over twelve", () => {
  const csv = ["Date,Description,Amount", "03/09/2026,A,1", "25/09/2026,B,2"].join("\n");
  const s = readStatement(csv);
  assert.equal(s.dateOrder, "dmy");
  assert.deepEqual(s.rows.map((r) => r.date), ["2026-09-03", "2026-09-25"]);
});

test("pending and unreadable lines are skipped with a reason, not guessed at", () => {
  const csv = ["Date,Description,Amount", "Pending,AMAZON,-12.00", "09/04/2026,NOTICE,", "09/05/2026,OK,-1"].join("\n");
  const s = readStatement(csv);
  assert.deepEqual(s.rows.map((r) => r.text), ["OK"]);
  assert.deepEqual(s.skipped.map((k) => k.line), [2, 3]);
});

test("a file that isn't a bank export says so", () => {
  const s = readStatement("hello\nworld\n");
  assert.ok(s.error);
  assert.equal(s.rows.length, 0);
});

test("refs are stable across uploads and tell identical lines on one day apart", () => {
  const rows = [
    { line: 2, date: "2026-09-05", amount: -25, text: "SERVICE FEE" },
    { line: 3, date: "2026-09-05", amount: -25, text: "SERVICE FEE" },
    { line: 4, date: "2026-09-06", amount: -25, text: "SERVICE FEE" },
  ];
  const a = withRefs(rows).map((r) => r.ref);
  assert.equal(new Set(a).size, 3);
  // Same lines in a later, overlapping export: same ids, whatever the line numbers.
  const b = withRefs([{ line: 40, date: "2026-09-04", amount: 9, text: "X" }, ...rows.map((r) => ({ ...r, line: r.line + 50 }))]).map((r) => r.ref);
  assert.deepEqual(b.slice(1), a);
  // Spacing and case in the description don't change it.
  assert.equal(withRefs([{ line: 1, date: "2026-09-05", amount: -25, text: "service  fee" }])[0].ref, a[0]);
  for (const ref of a) assert.match(ref, REF_PATTERN);
});
