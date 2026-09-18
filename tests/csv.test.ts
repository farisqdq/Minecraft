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
