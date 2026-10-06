import { test } from "node:test";
import assert from "node:assert/strict";
import { ariaSort, compareValues, nextSort, sortRows } from "../lib/sort-table.ts";

type Row = { name: string; rent: number | null; since?: Date | null };
const rows: Row[] = [
  { name: "Unit 10", rent: 1200 },
  { name: "unit 2", rent: null },
  { name: "Unit 1", rent: 1500 },
  { name: "Unit 3", rent: 1200 },
];

test("strings sort naturally and ignore case", () => {
  assert.deepEqual(sortRows(rows, (r) => r.name).map((r) => r.name), ["Unit 1", "unit 2", "Unit 3", "Unit 10"]);
});

test("numbers sort numerically in both directions", () => {
  assert.deepEqual(sortRows(rows, (r) => r.rent, "desc").map((r) => r.name), ["Unit 1", "Unit 10", "Unit 3", "unit 2"]);
  assert.deepEqual(sortRows(rows, (r) => r.rent, "asc").map((r) => r.name), ["Unit 10", "Unit 3", "Unit 1", "unit 2"]);
});

test("blanks sink to the bottom whichever way the column runs", () => {
  assert.equal(sortRows(rows, (r) => r.rent, "asc").at(-1)?.name, "unit 2");
  assert.equal(sortRows(rows, (r) => r.rent, "desc").at(-1)?.name, "unit 2");
});

test("ties keep their incoming order (stable)", () => {
  const out = sortRows(rows, (r) => r.rent, "asc").filter((r) => r.rent === 1200);
  assert.deepEqual(out.map((r) => r.name), ["Unit 10", "Unit 3"]);
  const outDesc = sortRows(rows, (r) => r.rent, "desc").filter((r) => r.rent === 1200);
  assert.deepEqual(outDesc.map((r) => r.name), ["Unit 10", "Unit 3"]);
});

test("dates sort by time and invalid dates count as blank", () => {
  const d = [
    { id: "b", at: new Date("2026-03-01") },
    { id: "x", at: new Date("nope") },
    { id: "a", at: new Date("2025-12-31") },
  ];
  assert.deepEqual(sortRows(d, (r) => r.at).map((r) => r.id), ["a", "b", "x"]);
});

test("the input array is not mutated", () => {
  const copy = rows.slice();
  sortRows(rows, (r) => r.name, "desc");
  assert.deepEqual(rows, copy);
});

test("compareValues falls back to text for mixed types", () => {
  assert.ok(compareValues(2, "10") < 0);
});

test("nextSort flips the same column and starts a new one at its natural direction", () => {
  assert.deepEqual(nextSort(null, "date", "desc"), { key: "date", dir: "desc" });
  assert.deepEqual(nextSort({ key: "date", dir: "desc" }, "date"), { key: "date", dir: "asc" });
  assert.deepEqual(nextSort({ key: "date", dir: "asc" }, "amount", "desc"), { key: "amount", dir: "desc" });
});

test("ariaSort names the order only on the sorted column", () => {
  assert.equal(ariaSort({ key: "a", dir: "asc" }, "a"), "ascending");
  assert.equal(ariaSort({ key: "a", dir: "desc" }, "a"), "descending");
  assert.equal(ariaSort({ key: "a", dir: "asc" }, "b"), "none");
  assert.equal(ariaSort(null, "b"), "none");
});
