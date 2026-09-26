import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  parseMoveOutInput,
  returnLabel,
  returnState,
  settle,
  suggestRentDeduction,
} from "../lib/move-out.ts";

const base = { movedOutOn: "2026-09-30", lastRentMonth: "2026-09", deductions: [] };

test("a clean move-out gives the whole deposit back", () => {
  const r = settle(2400, 0, []);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { deposit: 2400, rentApplied: 0, charges: 0, kept: 0, refund: 2400, stillOwed: 0 });
});

test("the deposit pays rent owed and damage, and the rest goes back", () => {
  const r = settle(2400, 1200, [
    { kind: "rent", label: "Unpaid rent", amount: 1200 },
    { kind: "charge", label: "Carpet cleaning", amount: 185.5 },
    { kind: "charge", label: "Broken blinds", amount: 64.25 },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    deposit: 2400,
    rentApplied: 1200,
    charges: 249.75,
    kept: 1449.75,
    refund: 950.25,
    stillOwed: 0,
  });
});

test("owing more than the deposit leaves the rest on their balance", () => {
  const r = settle(1000, 3600, [{ kind: "rent", label: "Unpaid rent", amount: 1000 }]);
  assert.ok(r.ok);
  assert.equal(r.value.refund, 0);
  assert.equal(r.value.stillOwed, 2600);
});

test("you can't keep more than you hold", () => {
  const r = settle(1000, 3600, [
    { kind: "rent", label: "Unpaid rent", amount: 1000 },
    { kind: "charge", label: "Paint", amount: 0.01 },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /more than the \$1000\.00 deposit/);
});

test("you can't apply the deposit to rent they don't owe", () => {
  const none = settle(2400, 0, [{ kind: "rent", label: "Unpaid rent", amount: 100 }]);
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.error, /don't owe any rent/);
  const some = settle(2400, 99.99, [{ kind: "rent", label: "Unpaid rent", amount: 100 }]);
  assert.equal(some.ok, false);
  if (!some.ok) assert.match(some.error, /\$99\.99/);
});

test("amounts add in cents, so twenty lines of $0.10 come to exactly $2", () => {
  const lines = Array.from({ length: 20 }, () => ({ kind: "charge" as const, label: "x", amount: 0.1 }));
  const r = settle(2, 0, lines);
  assert.ok(r.ok);
  assert.equal(r.value.refund, 0);
  assert.equal(r.value.kept, 2);
});

test("the suggested rent deduction is what's owed, capped at the deposit", () => {
  assert.equal(suggestRentDeduction(2400, 1200), 1200);
  assert.equal(suggestRentDeduction(1000, 3600), 1000);
  assert.equal(suggestRentDeduction(2400, -50), 0, "a tenant in credit owes nothing");
});

test("the form takes a date, a last month and itemized lines", () => {
  const r = parseMoveOutInput({
    ...base,
    deductions: [
      { kind: "rent", label: "", amount: "1200" },
      { kind: "charge", label: " Carpet cleaning ", amount: 185.499 },
      { kind: "charge", label: "", amount: "" },
    ],
    returnBy: "2026-10-30",
    forwardingAddress: "  44 Oak Ave, Springfield ",
  });
  assert.ok(r.ok);
  assert.deepEqual(r.value.deductions, [
    { kind: "rent", label: "Unpaid rent", amount: 1200 },
    { kind: "charge", label: "Carpet cleaning", amount: 185.5 },
  ]);
  assert.equal(r.value.forwardingAddress, "44 Oak Ave, Springfield");
  assert.equal(r.value.returnBy, "2026-10-30");
});

test("a charge without a reason is refused — the tenant is owed an itemized list", () => {
  const r = parseMoveOutInput({ ...base, deductions: [{ kind: "charge", label: " ", amount: 50 }] });
  assert.equal(r.ok, false);
});

test("the form refuses impossible dates and amounts", () => {
  assert.equal(parseMoveOutInput({ ...base, movedOutOn: "2026-02-30" }).ok, false);
  assert.equal(parseMoveOutInput({ ...base, lastRentMonth: "2026-9" }).ok, false);
  assert.equal(parseMoveOutInput({ ...base, returnBy: "2026-09-01" }).ok, false, "due before they left");
  assert.equal(parseMoveOutInput({ ...base, deductions: [{ kind: "charge", label: "x", amount: -5 }] }).ok, false);
  assert.equal(parseMoveOutInput({ ...base, deductions: [{ kind: "charge", label: "x", amount: "1e309" }] }).ok, false);
  assert.equal(parseMoveOutInput(null).ok, false);
});

test("the return deadline counts calendar days across a month end", () => {
  assert.equal(addDays("2026-09-30", 30), "2026-10-30");
  assert.equal(addDays("2026-01-31", 30), "2026-03-02");
});

test("a deposit return is due, then overdue, until it's marked returned", () => {
  const m = { deposit: 2400, returnBy: "2026-10-30", returnedOn: null };
  assert.deepEqual(returnState(m, "2026-10-26"), { kind: "due", days: 4 });
  assert.equal(returnLabel(returnState(m, "2026-10-30")), "due today");
  assert.equal(returnLabel(returnState(m, "2026-11-02")), "3 days overdue");
  assert.equal(returnState({ ...m, returnedOn: "2026-10-03" }, "2026-11-02").kind, "returned");
});

test("with no deposit held there's nothing to return", () => {
  assert.equal(returnState({ deposit: 0, returnBy: null, returnedOn: null }, "2026-10-01").kind, "none");
});
