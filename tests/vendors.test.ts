import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTrade, phoneProblem, rankForRepair, tradeFor } from "../lib/vendors.ts";

test("unknown trades fall back to General rather than failing", () => {
  assert.equal(normalizeTrade("plumbing"), "Plumbing");
  assert.equal(normalizeTrade("  HVAC "), "HVAC");
  assert.equal(normalizeTrade("Underwater basket weaving"), "General");
  assert.equal(normalizeTrade(42), "General");
});

test("each repair category points at a trade", () => {
  assert.equal(tradeFor("Plumbing"), "Plumbing");
  assert.equal(tradeFor("Heating / AC"), "HVAC");
  assert.equal(tradeFor("Parking lot / exterior"), "Paving & lot");
  assert.equal(tradeFor("Other"), "General");
  assert.equal(tradeFor("something new"), "General");
});

test("the right trade comes first, then the handyman, then the rest", () => {
  const v = [
    { name: "Sparky", trade: "Electrical", lastUsed: "2026-09-01" },
    { name: "Handy Hal", trade: "General", lastUsed: "2026-01-01" },
    { name: "Drip Co", trade: "Plumbing", lastUsed: "" },
    { name: "Pipe Pros", trade: "Plumbing", lastUsed: "2026-08-15" },
  ];
  assert.deepEqual(
    rankForRepair(v, "Plumbing").map((x) => x.name),
    ["Pipe Pros", "Drip Co", "Handy Hal", "Sparky"],
    "used most recently leads within a trade"
  );
  // Nobody is dropped.
  assert.equal(rankForRepair(v, "Pests").length, 4);
  // Doesn't reorder the caller's array.
  assert.equal(v[0].name, "Sparky");
});

test("phone numbers you could not dial are caught", () => {
  assert.equal(phoneProblem(""), "", "blank is allowed — email-only vendors exist");
  assert.equal(phoneProblem("(859) 684-4729"), "");
  assert.equal(phoneProblem("+1 859 684 4729"), "");
  assert.notEqual(phoneProblem("684-4729"), "", "seven digits is missing the area code");
});
