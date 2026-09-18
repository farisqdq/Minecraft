import { test } from "node:test";
import assert from "node:assert/strict";
import { money, moneyRound, signedMoney } from "../lib/money.ts";

test("whole dollars print without cents", () => {
  assert.equal(money(1450), "$1,450");
  assert.equal(money(0), "$0");
});

test("cents print when there are cents", () => {
  assert.equal(money(1450.5), "$1,450.50");
  assert.equal(money(412.6), "$412.60");
});

test("a fractional amount is never silently rounded away", () => {
  // The ledger used to round $412.60 to $413, which quietly misstated a bill.
  assert.notEqual(money(412.6), "$413");
});

test("moneyRound always drops the cents, for axes and summaries", () => {
  assert.equal(moneyRound(1450.5), "$1,451");
  assert.equal(moneyRound(1450), "$1,450");
});

test("negatives use a real minus sign so tabular figures line up", () => {
  assert.equal(signedMoney(-1450), "−$1,450");
  assert.equal(signedMoney(1450), "$1,450");
  assert.equal(signedMoney(0), "$0");
});
