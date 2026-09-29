import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStatement, type ChargeInput, type PaymentInput } from "../lib/balance.ts";
import { lateFeesPerMonth, rentOwed } from "../lib/rent-owed.ts";

/**
 * Builds what lib/statements.ts hands back, from months of rent, charges and
 * payments: the statement itself, the late-rule fees by month, and the
 * charge list with `automatic` set the way a rule's charge has it.
 */
function books(opts: {
  start: string;
  current: string;
  rent?: number;
  /** Late fees a rule made, by month. */
  ruleLateFees?: Record<string, number>;
  /** Charges a person typed in. */
  manual?: ChargeInput[];
  payments?: PaymentInput[];
}) {
  const ruleCharges: ChargeInput[] = Object.entries(opts.ruleLateFees ?? {}).map(([month, amount]) => ({
    month,
    kind: "fee",
    amount,
    label: "Late fee",
  }));
  const manual = opts.manual ?? [];
  const statement = buildStatement({
    startMonth: opts.start,
    currentMonth: opts.current,
    rentFor: () => opts.rent ?? 1000,
    charges: [...ruleCharges, ...manual],
    payments: opts.payments ?? [],
  });
  return {
    statement,
    lateFeesByMonth: { ...(opts.ruleLateFees ?? {}) },
    charges: [
      ...ruleCharges.map((c) => ({ ...c, automatic: true })),
      ...manual.map((c) => ({ ...c, automatic: false })),
    ],
  };
}

test("$1,000 of rent unpaid with a $70 late fee: the rent figure is $1,000", () => {
  const b = books({ start: "2026-09", current: "2026-09", ruleLateFees: { "2026-09": 70 } });
  assert.equal(b.statement.balance, 1070, "the balance still carries the fee");
  assert.deepEqual(rentOwed(b), { rent: 1000, lateFees: 70, behindSince: "2026-09" });
});

test("part paid: the payment comes off the rent, the fee is still left out", () => {
  const b = books({
    start: "2026-09",
    current: "2026-09",
    ruleLateFees: { "2026-09": 70 },
    payments: [{ month: "2026-09", amount: 400 }],
  });
  assert.equal(rentOwed(b).rent, 600);
});

test("a late fee paid off in an earlier month isn't taken off again", () => {
  // August: rent and its $70 fee paid in full, so the account was square.
  // September: rent unpaid, no fee yet. All $1,000 is rent.
  const b = books({
    start: "2026-08",
    current: "2026-09",
    ruleLateFees: { "2026-08": 70 },
    payments: [{ month: "2026-08", amount: 1070 }],
  });
  assert.equal(b.statement.balance, 1000);
  assert.deepEqual(rentOwed(b), { rent: 1000, lateFees: 0, behindSince: "2026-09" });
});

test("two months behind: every late fee in the run comes off", () => {
  const b = books({
    start: "2026-08",
    current: "2026-09",
    ruleLateFees: { "2026-08": 70, "2026-09": 70 },
  });
  assert.equal(b.statement.balance, 2140);
  assert.deepEqual(rentOwed(b), { rent: 2000, lateFees: 140, behindSince: "2026-08" });
});

test("a month that owed only a late fee doesn't make the rent 'behind' from then", () => {
  // August's rent was paid but its fee wasn't; September's rent is unpaid.
  const b = books({
    start: "2026-08",
    current: "2026-09",
    ruleLateFees: { "2026-08": 70 },
    payments: [{ month: "2026-08", amount: 1000 }],
  });
  assert.equal(b.statement.behindSince, "2026-08", "the statement counts the fee");
  assert.deepEqual(rentOwed(b), { rent: 1000, lateFees: 70, behindSince: "2026-09" });
});

test("owing nothing but late fees is no rent owed", () => {
  const b = books({
    start: "2026-09",
    current: "2026-09",
    ruleLateFees: { "2026-09": 70 },
    payments: [{ month: "2026-09", amount: 1000 }],
  });
  assert.deepEqual(rentOwed(b), { rent: 0, lateFees: 70, behindSince: "" });
});

test("never below zero, and nothing owed when in credit", () => {
  const partFee = books({
    start: "2026-09",
    current: "2026-09",
    ruleLateFees: { "2026-09": 70 },
    payments: [{ month: "2026-09", amount: 1040 }],
  });
  assert.equal(partFee.statement.balance, 30);
  assert.deepEqual(rentOwed(partFee), { rent: 0, lateFees: 30, behindSince: "" });

  const credit = books({ start: "2026-09", current: "2026-09", payments: [{ month: "2026-09", amount: 1200 }] });
  assert.deepEqual(rentOwed(credit), { rent: 0, lateFees: 0, behindSince: "" });

  assert.deepEqual(rentOwed({ statement: { rows: [] }, lateFeesByMonth: {} }), { rent: 0, lateFees: 0, behindSince: "" });
});

test("a hand-typed late fee is a late fee; a lot fee stays in", () => {
  const b = books({
    start: "2026-09",
    current: "2026-09",
    manual: [
      { month: "2026-09", kind: "fee", amount: 50, label: "Late fee (August)" },
      { month: "2026-09", kind: "fee", amount: 25, label: "Lot fee" },
    ],
  });
  assert.equal(b.statement.balance, 1075);
  assert.deepEqual(lateFeesPerMonth(b), { "2026-09": 50 });
  // Only late fees are excluded; other charges are out of scope and stay.
  assert.equal(rentOwed(b).rent, 1025);
});

test("a word that merely contains 'late' isn't a late fee", () => {
  const b = books({
    start: "2026-09",
    current: "2026-09",
    manual: [{ month: "2026-09", kind: "fee", amount: 40, label: "Replace broken plate glass" }],
  });
  assert.equal(rentOwed(b).rent, 1040);
});
