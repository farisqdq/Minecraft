import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accumulatedThrough,
  depreciationFor,
  finalYear,
  parseAssetInput,
  type Asset,
} from "../lib/depreciation.ts";

const house = (inService: string, basis = 100_000): Asset => ({ basis, inService, cls: "residential" });

// IRS Publication 946, Table A-6 (residential rental, 27.5 years, mid-month):
// first-year rates by month placed in service, then 3.636% a year.
const FIRST_YEAR_RATE = [3.485, 3.182, 2.879, 2.576, 2.273, 1.97, 1.667, 1.364, 1.061, 0.758, 0.455, 0.152];

test("the first year matches the IRS table for every month", () => {
  FIRST_YEAR_RATE.forEach((rate, i) => {
    const month = String(i + 1).padStart(2, "0");
    const got = depreciationFor(house(`2020-${month}`), 2020);
    // The table rounds to three decimals of a percent: within $1 on $100,000.
    assert.ok(Math.abs(got - rate * 1000) < 1, `month ${month}: ${got} vs ${rate * 1000}`);
  });
});

test("a full year is 1/27.5 of the basis", () => {
  assert.equal(depreciationFor(house("2020-03"), 2021), 3636.36);
  // Mid-schedule years differ from each other by at most the cent the
  // running total rounds away.
  for (let y = 2021; y <= 2046; y++) {
    const d = depreciationFor(house("2020-03"), y);
    assert.ok(Math.abs(d - 3636.36) <= 0.01, `${y}: ${d}`);
  }
});

test("nothing before it's in service", () => {
  assert.equal(depreciationFor(house("2020-03"), 2019), 0);
  assert.equal(accumulatedThrough(house("2020-03"), 2019), 0);
});

test("the years add up to exactly the basis, never a cent over", () => {
  for (const month of ["01", "06", "12"]) {
    const a = house(`2020-${month}`, 287_345.67);
    let total = 0;
    for (let y = 2020; y <= 2060; y++) total += Math.round(depreciationFor(a, y) * 100);
    assert.equal(total, 28_734_567, `month ${month}`);
    assert.equal(depreciationFor(a, finalYear(a) + 1), 0);
    assert.ok(depreciationFor(a, finalYear(a)) > 0);
  }
});

test("a January building runs 28 tax years and ends on the table's last-year rate", () => {
  const a = house("2020-01");
  assert.equal(finalYear(a), 2047);
  // Table A-6, month 1, year 28: 1.970%.
  assert.ok(Math.abs(depreciationFor(a, 2047) - 1970) < 1);
});

test("a December building spills into a 29th tax year", () => {
  assert.equal(finalYear(house("2020-12")), 2048);
});

test("commercial buildings take 39 years", () => {
  const shop: Asset = { basis: 390_000, inService: "2020-07", cls: "commercial" };
  assert.equal(depreciationFor(shop, 2021), 10_000);
  // Half of July and five more months.
  assert.equal(depreciationFor(shop, 2020), 4583.33);
  assert.equal(finalYear(shop), 2059);
});

test("accumulated depreciation is the running total", () => {
  const a = house("2020-01");
  assert.equal(accumulatedThrough(a, 2021), Math.round((3484.85 + 3636.36) * 100) / 100);
});

test("the form accepts a statement's figures and refuses nonsense", () => {
  const ok = parseAssetInput({ kind: "building", label: "", basis: "$280,000", inService: "2019-03", cls: "residential" });
  assert.ok(ok.ok);
  assert.equal(ok.value.label, "Building");
  assert.equal(ok.value.basis, 280_000);
  assert.equal(parseAssetInput({ kind: "improvement", label: " ", basis: 100, inService: "2019-03" }).ok, false);
  assert.equal(parseAssetInput({ kind: "building", basis: 0, inService: "2019-03" }).ok, false);
  assert.equal(parseAssetInput({ kind: "building", basis: 100, inService: "2019-13" }).ok, false);
  const shop = parseAssetInput({ kind: "improvement", label: "Roof", basis: 14000, inService: "2026-06", cls: "commercial" });
  assert.ok(shop.ok && shop.value.cls === "commercial");
});
