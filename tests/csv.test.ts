import { test } from "node:test";
import assert from "node:assert/strict";
import { csvField, csvRow } from "../lib/csv.ts";
import { normalizeCategory, EXPENSE_CATEGORIES } from "../lib/categories.ts";

test("plain values are left unquoted so the file stays readable", () => {
  assert.equal(csvField("Woodchuck Ln"), "Woodchuck Ln");
  assert.equal(csvField(1450), "1450");
});

test("anything that would break a cell is quoted", () => {
  assert.equal(csvField("Smith, Plumbing"), '"Smith, Plumbing"');
  assert.equal(csvField('He said "fixed"'), '"He said ""fixed"""');
  assert.equal(csvField("line one\nline two"), '"line one\nline two"');
});

test("a note containing a comma cannot shift the columns after it", () => {
  const row = csvRow(["2026-09-01", "Cedar Row", "Paid, finally", "1750.00"]);
  assert.equal(row, '2026-09-01,Cedar Row,"Paid, finally",1750.00\r\n');
});

test("only known expense categories survive", () => {
  assert.equal(normalizeCategory("Insurance"), "Insurance");
  assert.equal(normalizeCategory("Made up"), null);
  assert.equal(normalizeCategory(""), null);
  assert.equal(normalizeCategory(undefined), null);
  assert.equal(normalizeCategory(42), null);
});

test("every listed category normalizes to itself", () => {
  for (const c of EXPENSE_CATEGORIES) assert.equal(normalizeCategory(c), c);
});

test("a formula in a note cannot execute in the reader's spreadsheet", () => {
  // Descriptions and notes are free text, and on a shared LLC a teammate may
  // have typed them. The owner opens the export; the cell must stay text.
  assert.equal(csvField("=1+1"), `"'=1+1"`);
  assert.equal(csvField("@SUM(A1:A9)"), `"'@SUM(A1:A9)"`);
  assert.equal(csvField("=cmd|'/c calc'!A0"), `"'=cmd|'/c calc'!A0"`);
  assert.equal(csvField("\tleading tab"), `"'\tleading tab"`);
});

test("real amounts are never turned into text", () => {
  // Defusing a leading "-" would break every expense in the file, and with it
  // any sum an accountant runs over the column.
  assert.equal(csvField("-795.00"), "-795.00");
  assert.equal(csvField("-0.5"), "-0.5");
  assert.equal(csvField(-795), "-795");
  assert.equal(csvField("1450.00"), "1450.00");
});

test("text that merely starts with a minus is defused, unlike a number", () => {
  assert.equal(csvField("-50% off the deposit"), `"'-50% off the deposit"`);
});

test("ordinary text is still left unquoted", () => {
  assert.equal(csvField("Fixed leaking kitchen faucet"), "Fixed leaking kitchen faucet");
  assert.equal(csvField("J. Alvarez"), "J. Alvarez");
});
