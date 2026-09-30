import { test } from "node:test";
import assert from "node:assert/strict";
import { fromFirstData, hasTrend, monthsWithData } from "../lib/cash-flow-series.ts";

const p = (month: string, rent: number, expense: number) => ({ month, rent, expense });

test("leading empty months are dropped, later gaps are kept", () => {
  const s = [p("2026-01", 0, 0), p("2026-02", 0, 0), p("2026-03", 0, 40), p("2026-04", 0, 0), p("2026-05", 900, 0)];
  assert.deepEqual(
    fromFirstData(s).map((x) => x.month),
    ["2026-03", "2026-04", "2026-05"]
  );
});

test("an expense alone starts the history, not only rent", () => {
  assert.equal(fromFirstData([p("2026-01", 0, 0), p("2026-02", 0, 12)])[0].month, "2026-02");
});

test("a series with nothing in it trims to empty", () => {
  assert.deepEqual(fromFirstData([p("2026-01", 0, 0), p("2026-02", 0, 0)]), []);
});

test("a trend needs at least two months with data", () => {
  assert.equal(hasTrend([p("2026-01", 0, 0), p("2026-02", 500, 0)]), false);
  assert.equal(hasTrend([p("2026-01", 10, 0), p("2026-02", 0, 0), p("2026-03", 0, 5)]), true);
  assert.equal(monthsWithData([p("2026-01", 0.001, 0)]), 0);
});
