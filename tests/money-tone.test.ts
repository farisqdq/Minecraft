import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyTone, owedTone, toneClass } from "../lib/money-tone.ts";

test("positive and negative figures carry their sign's tone", () => {
  assert.equal(moneyTone(1250), "pos");
  assert.equal(moneyTone(-40.5), "neg");
});

test("zero is neutral, never red or green", () => {
  assert.equal(moneyTone(0), "zero");
  assert.equal(moneyTone(-0), "zero");
});

test("amounts that print as $0.00 are neutral too", () => {
  assert.equal(moneyTone(0.004), "zero");
  assert.equal(moneyTone(-0.0049), "zero");
  assert.equal(moneyTone(0.005), "pos");
});

test("non-finite input is neutral rather than alarming", () => {
  assert.equal(moneyTone(Number.NaN), "zero");
  assert.equal(moneyTone(Number.POSITIVE_INFINITY), "zero");
});

test("owed flips the sign: owing is bad, a credit is good", () => {
  assert.equal(owedTone(300), "neg");
  assert.equal(owedTone(-25), "pos");
  assert.equal(owedTone(0), "zero");
});

test("toneClass reads the module's class, or nothing when it has none", () => {
  const styles = { pos: "a_pos", neg: "a_neg" };
  assert.equal(toneClass(styles, "pos"), "a_pos");
  assert.equal(toneClass(styles, "zero"), "");
});
