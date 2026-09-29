import test from "node:test";
import assert from "node:assert/strict";
import { countsToward, rentTargetOf, soleUnitId, unitIdsCountingToward } from "../lib/rent-target.ts";

const A = { id: "unitA" };
const B = { id: "unitB" };

test("a single-unit property: the whole property is its unit", () => {
  assert.equal(soleUnitId([A]), "unitA");
  assert.equal(rentTargetOf(null, [A]), "unitA", "tenant or payment on the whole property");
  assert.equal(rentTargetOf("unitA", [A]), "unitA");
  assert.deepEqual(unitIdsCountingToward(null, [A]), ["unitA", null]);
  assert.deepEqual(unitIdsCountingToward("unitA", [A]), ["unitA", null]);
  // The Furniture Store: $867.22 logged against the whole property is #A's rent.
  assert.equal(countsToward(null, "unitA", [A]), true);
  assert.equal(countsToward("unitA", null, [A]), true);
});

test("several units: whole-property entries stay unattributed", () => {
  assert.equal(soleUnitId([A, B]), null);
  assert.equal(rentTargetOf(null, [A, B]), null);
  assert.deepEqual(unitIdsCountingToward(null, [A, B]), [null]);
  assert.deepEqual(unitIdsCountingToward("unitA", [A, B]), ["unitA"]);
  assert.equal(countsToward(null, "unitA", [A, B]), false);
  assert.equal(countsToward("unitB", "unitA", [A, B]), false);
  assert.equal(countsToward(null, null, [A, B]), true);
});

test("no units: the property is the only place", () => {
  assert.equal(soleUnitId([]), null);
  assert.equal(rentTargetOf(null, []), null);
  assert.deepEqual(unitIdsCountingToward(null, []), [null]);
  assert.equal(countsToward(null, null, []), true);
});
