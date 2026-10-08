import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, addMonths, parseSpreadMonths, spreadForReports, spreadSummary } from "../lib/spread.ts";
import { buildMonth } from "../lib/calendar.ts";

const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

test("a yearly tax bill spreads evenly across twelve months from the month it's paid", () => {
  const tax = { type: "expense", date: "2026-01-20", amount: 3600, spreadMonths: 12 };
  const parts = allocate(tax);
  assert.equal(parts.length, 12);
  assert.deepEqual(parts[0], { month: "2026-01", amount: 300 });
  assert.deepEqual(parts[11], { month: "2026-12", amount: 300 });
});

test("shares add back to the amount to the cent, leftover cents first", () => {
  const odd = allocate({ type: "expense", date: "2026-03-01", amount: 1000, spreadMonths: 3 });
  assert.deepEqual(odd.map((p) => p.amount), [333.34, 333.33, 333.33]);
  assert.equal(sum(odd), 1000);
  const ugly = allocate({ type: "expense", date: "2026-03-01", amount: 4321.07, spreadMonths: 7 });
  assert.equal(sum(ugly), 4321.07);
});

test("a spread can start in another month and run across the new year", () => {
  // Paid in December for the coming year.
  const parts = allocate({ type: "expense", date: "2025-12-15", amount: 1200, appliesTo: "2026-01", spreadMonths: 12 });
  assert.equal(parts[0].month, "2026-01");
  assert.equal(parts[11].month, "2026-12");
  assert.equal(addMonths("2026-11", 3), "2027-02");
});

test("entries that aren't spread land whole in one month", () => {
  assert.deepEqual(allocate({ type: "expense", date: "2026-05-09", amount: 80 }), [{ month: "2026-05", amount: 80 }]);
  assert.deepEqual(allocate({ type: "rent", date: "2026-10-03", amount: 950, appliesTo: "2026-09" }), [
    { month: "2026-09", amount: 950 },
  ]);
  assert.deepEqual(allocate({ type: "expense", date: "2026-05-09", amount: 80, spreadMonths: 1 }), [
    { month: "2026-05", amount: 80 },
  ]);
});

test("reports see one copy per month; everything else passes through untouched", () => {
  type Row = { type: string; date: string; amount: number; spreadMonths?: number | null };
  const plain: Row = { type: "rent", date: "2026-02-01", amount: 900 };
  const tax: Row = { type: "expense", date: "2026-01-20", amount: 3600, spreadMonths: 12 };
  const out = spreadForReports([plain, tax]);
  assert.equal(out.length, 13);
  assert.equal(out[0], plain, "unspread entries are the same object");
  assert.equal(out[1].date, "2026-01-15");
  assert.equal(out[12].date, "2026-12-15");
  assert.equal(sum(out.filter((t) => t.type === "expense")), 3600);
  assert.ok(out.slice(1).every((t) => t.spreadMonths === null));
});

test("what a form sends for the number of months is checked", () => {
  assert.equal(parseSpreadMonths(undefined), undefined);
  assert.equal(parseSpreadMonths(null), null);
  assert.equal(parseSpreadMonths(0), null);
  assert.equal(parseSpreadMonths(1), null);
  assert.equal(parseSpreadMonths(12), 12);
  assert.equal(parseSpreadMonths("6"), 6);
  assert.equal(parseSpreadMonths(37), false);
  assert.equal(parseSpreadMonths(2.5), false);
  assert.equal(parseSpreadMonths("twelve"), false);
});

test("the summary line says how it's spread", () => {
  assert.equal(
    spreadSummary({ type: "expense", date: "2026-01-20", amount: 3600, spreadMonths: 12 }),
    "Spread over 12 months, Jan–Dec 2026 · $300.00 a month"
  );
  assert.equal(
    spreadSummary({ type: "rent", date: "2026-11-01", amount: 6000, spreadMonths: 6 }),
    "Spread over 6 months, Nov 2026 – Apr 2027 · $1,000.00 a month"
  );
  assert.equal(spreadSummary({ type: "expense", date: "2026-01-20", amount: 50 }), "");
});

test("six months' rent paid at once pays each of those months on the calendar", () => {
  const target = { key: "p|", propertyId: "p", unitId: null, label: "House", companyId: "c", vacant: false };
  const tenant = { id: "t", name: "Sam", propertyId: "p", unitId: null, dueDay: 1, phone: "" };
  const opts = {
    targets: [target],
    tenants: [tenant],
    rentFor: () => 1000,
    payments: [{ propertyId: "p", unitId: null, date: "2026-07-01", amount: 6000, spreadMonths: 6 }],
    today: "2026-10-10",
  };
  for (const m of ["2026-07", "2026-08", "2026-12"]) assert.equal(buildMonth({ ...opts, month: m }).collected, 1000, m);
  assert.equal(buildMonth({ ...opts, month: "2027-01" }).collected, 0, "January isn't covered");
});
