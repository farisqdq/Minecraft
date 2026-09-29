import test from "node:test";
import assert from "node:assert/strict";
import {
  amountField,
  amountOwed,
  bulkSummary,
  dateInMonth,
  dayOf,
  entryDateFor,
  entryLabels,
  monthBounds,
  monthLabel,
  owedLine,
  parseRecurringOverrides,
  recurringPrefill,
  rentNote,
  rentPrefill,
} from "../lib/quick-record.ts";

test("amount owed includes late fees, less what came in, never negative", () => {
  assert.equal(amountOwed({ expected: 1000, paid: 0, fees: 70 }), 1070);
  assert.equal(amountOwed({ expected: 1000, paid: 400, fees: 70 }), 670);
  assert.equal(amountOwed({ expected: 1000, paid: 0 }), 1000, "no fees on file");
  assert.equal(amountOwed({ expected: 1000, paid: 1200, fees: 0 }), 0, "overpaid is nothing owed");
  assert.equal(amountOwed({ expected: 0.1, paid: 0, fees: 0.2 }), 0.3, "to the cent, no float dust");
});

test("amount field text", () => {
  assert.equal(amountField(1070), "1070");
  assert.equal(amountField(412.6), "412.60");
  assert.equal(amountField(0), "");
  assert.equal(amountField(-5), "");
  assert.equal(amountField(Number.NaN), "");
});

test("the entry's date keeps the month it's for", () => {
  assert.equal(entryDateFor("2026-09", "2026-09-29"), "2026-09-29", "today, in the month on screen");
  assert.equal(entryDateFor("2026-08", "2026-09-29"), "2026-08-01", "an earlier month lands on its 1st");
  assert.equal(entryDateFor("2026-08", "2026-09-29", "2026-08-05"), "2026-08-05", "or the given due date");
  assert.equal(entryDateFor("2026-08", "2026-09-29", "2026-09-05"), "2026-08-01", "a fallback outside the month is ignored");
});

test("month helpers", () => {
  assert.equal(monthLabel("2026-09"), "September 2026");
  assert.equal(monthLabel("nope"), "");
  assert.equal(rentNote("2026-09"), "September 2026 rent");
  assert.equal(dayOf("2026-09", 31), "2026-09-30");
  assert.equal(dayOf("2026-02", 30), "2026-02-28");
  assert.equal(dayOf("2026-09", 0), "2026-09-01");
  assert.deepEqual(monthBounds("2028-02"), { min: "2028-02-01", max: "2028-02-29" });
  assert.equal(dateInMonth("2026-09-15", "2026-09"), true);
  assert.equal(dateInMonth("2026-10-01", "2026-09"), false);
  assert.equal(dateInMonth("2026-09-31", "2026-09"), false);
  assert.equal(dateInMonth("", "2026-09"), false);
});

test("rent prefill from a Needs attention row", () => {
  assert.deepEqual(
    rentPrefill({ month: "2026-09", today: "2026-09-29", expected: 1000, paid: 0, fees: 70, tenantName: "Sam Lee" }),
    { type: "rent", amount: "1070", date: "2026-09-29", detail: "Sam Lee", note: "September 2026 rent", category: "" }
  );
  const calendar = rentPrefill({
    month: "2026-10",
    today: "2026-09-29",
    expected: 1200,
    paid: 200,
    fallbackDate: "2026-10-05",
  });
  assert.equal(calendar.amount, "1000");
  assert.equal(calendar.date, "2026-10-05");
  assert.equal(calendar.detail, "");
});

test("recurring prefill is dated on the bill's day in that month", () => {
  const water = { amount: 84.5, category: "Utilities", detail: "City Water", note: "Acct 42", day: 31 };
  assert.deepEqual(recurringPrefill(water, "2026-09"), {
    type: "expense",
    amount: "84.50",
    date: "2026-09-30",
    detail: "City Water",
    note: "Acct 42",
    category: "Utilities",
  });
  assert.equal(recurringPrefill(water, "2026-02").date, "2026-02-28");
});

test("labels", () => {
  assert.equal(entryLabels("rent").submit, "Record payment");
  assert.equal(entryLabels("rent").detail, "Paid by (tenant)");
  assert.equal(entryLabels("expense").submit, "Log expense");
  assert.equal(entryLabels("expense").detail, "Paid to");
  assert.equal(entryLabels("expense", { recurring: true }).title, "Log this bill");
  assert.equal(entryLabels("rent", { editing: true }).submit, "Save changes");
});

test("bulk summary lists each amount and the total", () => {
  const s = bulkSummary([
    { name: "Sam", owed: 1070 },
    { name: "Ana", owed: 950.5 },
    { name: "Paid up", owed: 0 },
  ]);
  assert.equal(s.total, 2020.5);
  assert.deepEqual(s.text, ["Sam: $1,070", "Ana: $950.50"]);
});

test("recurring overrides are checked against the month being logged", () => {
  const ok = (c: string) => c === "Utilities" || c === "Insurance";
  assert.deepEqual(parseRecurringOverrides({ month: "2026-09" }, "2026-09", ok), { ok: true, value: {} });
  assert.deepEqual(
    parseRecurringOverrides(
      { amount: "90.126", date: "2026-09-12", note: "  paid online ", detail: "City Water", category: "Utilities" },
      "2026-09",
      ok
    ),
    { ok: true, value: { amount: 90.13, date: "2026-09-12", note: "paid online", detail: "City Water", category: "Utilities" } }
  );
  const wrongMonth = parseRecurringOverrides({ date: "2026-10-01" }, "2026-09", ok);
  assert.equal(wrongMonth.ok, false);
  assert.match(!wrongMonth.ok ? wrongMonth.error : "", /September 2026/);
  assert.equal(parseRecurringOverrides({ amount: 0 }, "2026-09", ok).ok, false);
  assert.equal(parseRecurringOverrides({ amount: "abc" }, "2026-09", ok).ok, false);
  assert.equal(parseRecurringOverrides({ category: "Snacks" }, "2026-09", ok).ok, false);
  assert.equal(parseRecurringOverrides(null, "2026-09", ok).ok, true);
});

test("owed line explains the prefilled amount", () => {
  assert.equal(owedLine({ expected: 1000, paid: 0, fees: 70 }), "$1,000 rent + $70 late fees");
  assert.equal(owedLine({ expected: 1000, paid: 400 }), "$1,000 rent, $400 paid so far");
  assert.equal(owedLine({ expected: 1200, paid: 0 }, "due"), "$1,200 due");
});
