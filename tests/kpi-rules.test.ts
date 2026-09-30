import { test } from "node:test";
import assert from "node:assert/strict";
import { comparable, hasTrend } from "../lib/kpi-rules.ts";

test("a trend line waits for three months with data", () => {
  assert.equal(hasTrend([0, 0, 0, 0, 37112.38]), false);
  assert.equal(hasTrend([0, 0, 120, 0, 37112.38]), false);
  assert.equal(hasTrend([0, 900, 120, 0, 37112.38]), true);
  assert.equal(hasTrend([]), false);
});

test("a change is only shown against a previous period that had something", () => {
  assert.equal(comparable(undefined), false);
  assert.equal(comparable(0), false);
  assert.equal(comparable(1850), true);
  assert.equal(comparable(-320), true);
  assert.equal(comparable(1850, true), false);
});
