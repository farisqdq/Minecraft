import { test } from "node:test";
import assert from "node:assert/strict";
import { generateJoinCode, normalizeJoinCode, formatJoinCode } from "../lib/codes.ts";

test("a join code avoids characters that get misread aloud", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateJoinCode();
    assert.equal(code.length, 8);
    assert.doesNotMatch(code, /[ILO01]/, `${code} contains an ambiguous character`);
  }
});

test("codes are not all the same", () => {
  const seen = new Set(Array.from({ length: 50 }, generateJoinCode));
  assert.ok(seen.size > 45, "codes should not collide this often");
});

test("whatever the person types is accepted", () => {
  assert.equal(normalizeJoinCode("k7p2-m9x4"), "K7P2M9X4");
  assert.equal(normalizeJoinCode("  K7P2 M9X4  "), "K7P2M9X4");
  assert.equal(normalizeJoinCode("K7P2_M9X4!"), "K7P2M9X4");
});

test("a full-length code is shown in two halves, anything else is left alone", () => {
  assert.equal(formatJoinCode("K7P2M9X4"), "K7P2-M9X4");
  assert.equal(formatJoinCode("SHORT"), "SHORT");
});
