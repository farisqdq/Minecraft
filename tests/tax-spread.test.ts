import { test } from "node:test";
import assert from "node:assert/strict";
import { taxYearLines } from "../lib/tax-spread.ts";

const tax = { type: "expense", date: "2026-01-20", amount: 3600, appliesTo: "2026-07", spreadMonths: 12, note: null };

test("a spread bill splits across tax years by its monthly shares", () => {
  const y26 = taxYearLines([tax], 2026);
  const y27 = taxYearLines([tax], 2027);
  assert.equal(y26.length, 1);
  assert.equal(y26[0].amount, 1800);
  assert.equal(y26[0].day, "2026-01-20");
  assert.match(y26[0].note!, /12-month spread, 6 months in 2026 \(\$300\.00\/mo\)/);
  assert.equal(y27[0].amount, 1800);
  assert.equal(y27[0].day, "2027-01-01");
  assert.deepEqual(taxYearLines([tax], 2025), []);
});

test("unspread entries go by date; appliesTo on rent does not move them", () => {
  const rent = { type: "rent", date: "2026-01-03", amount: 1000, appliesTo: "2025-12", note: "x" };
  const out = taxYearLines([rent], 2026);
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 1000);
  assert.equal(out[0].note, "x");
  assert.deepEqual(taxYearLines([rent], 2025), []);
});

test("shares in a year add to the cent, and existing notes are kept", () => {
  const t = { type: "expense", date: "2026-03-01", amount: 1000, spreadMonths: 3, note: "bill" };
  const [l] = taxYearLines([t], 2026);
  assert.equal(l.amount, 1000);
  assert.match(l.note!, /^bill · 3-month spread, all in 2026/);
});
