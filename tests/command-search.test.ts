import test from "node:test";
import assert from "node:assert/strict";
import { hitReason, initialsOf, rankHits } from "../lib/layouts/command-search.ts";

const hit = (
  id: string,
  name: string,
  extra: Partial<{ address: string; company: string; units: string[]; tenants: string[] }> = {}
) => ({
  id,
  name,
  address: "",
  company: "Maple LLC",
  units: [] as string[],
  tenants: [] as string[],
  ...extra,
});

test("ranks name prefix above word, contains, tenant, address, unit and LLC", () => {
  const items = [
    hit("llc", "Zeta", { company: "Oak Holdings" }),
    hit("unit", "Yard", { units: ["Oak suite"] }),
    hit("addr", "Xylo", { address: "1 Oak St" }),
    hit("tenant", "Wren", { tenants: ["Sam Oakley"] }),
    hit("contains", "Brooak"),
    hit("word", "Big Oak"),
    hit("prefix", "Oakwood"),
  ];
  assert.deepEqual(
    rankHits(items, " oak ").map((h) => h.id),
    ["prefix", "word", "contains", "tenant", "addr", "unit", "llc"]
  );
  assert.deepEqual(rankHits(items, ""), []);
  assert.equal(rankHits(items, "oak", 2).length, 2);
});

test("says why a hit matched", () => {
  assert.equal(hitReason(hit("a", "Wren", { tenants: ["Sam Oakley"], address: "9 Elm" }), "oak"), "Sam Oakley");
  assert.equal(hitReason(hit("a", "Yard", { units: ["Oak suite"] }), "oak"), "Oak suite · Maple LLC");
  assert.equal(hitReason(hit("a", "Oakwood", { address: "9 Elm" }), "oak"), "9 Elm");
});

test("initials", () => {
  assert.equal(initialsOf("Jordan Lee"), "JL");
  assert.equal(initialsOf("landlord@demo.local"), "L");
  assert.equal(initialsOf("mary-kate o"), "MO");
  assert.equal(initialsOf(""), "?");
});
