import { test } from "node:test";
import assert from "node:assert/strict";
import { due1099, normalizeTaxClass, rows1099, threshold1099 } from "../lib/tax1099.ts";

test("the threshold is $600 through 2025 and $2,000 from 2026", () => {
  assert.equal(threshold1099(2024), 600);
  assert.equal(threshold1099(2025), 600);
  assert.equal(threshold1099(2026), 2000);
  assert.equal(threshold1099(2027), 2000);
});

test("the due date is January 31st, or the Monday after a weekend", () => {
  // Jan 31, 2026 is a Saturday; 2027 a Sunday; 2028 a Monday.
  assert.equal(due1099(2025), "2026-02-02");
  assert.equal(due1099(2026), "2027-02-01");
  assert.equal(due1099(2027), "2028-01-31");
});

test("tax class only takes the three known values", () => {
  assert.equal(normalizeTaxClass("corporation"), "corporation");
  assert.equal(normalizeTaxClass("Corporation"), null);
  assert.equal(normalizeTaxClass(""), null);
});

const vendors = [
  { id: "plumb", name: "Bluegrass Plumbing", taxClass: "individual" as const },
  { id: "roof", name: "Acme Roofing Inc", taxClass: "corporation" as const },
  { id: "law", name: "Smith Law PLLC", taxClass: "corporation" as const },
  { id: "handy", name: "Joe the Handyman", taxClass: null },
  { id: "mow", name: "Lawn Guys", taxClass: "partnership" as const },
  { id: "idle", name: "Never Paid", taxClass: null },
];
const pay = (vendorId: string, amount: number, category = "Repairs & Maintenance") => ({ vendorId, amount, category });

test("who files, who's exempt, who needs a W-9 — over 2026's $2,000 line", () => {
  const rows = rows1099(
    vendors,
    [
      pay("plumb", 1500),
      pay("plumb", 700),
      pay("roof", 9000),
      pay("law", 2400, "Legal & Professional"),
      pay("handy", 2500),
      pay("mow", 1999.99),
    ],
    new Set(["plumb"]),
    2026
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.status, r.total]),
    [
      ["Smith Law PLLC", "file", 2400],
      ["Bluegrass Plumbing", "file", 2200],
      ["Joe the Handyman", "check", 2500],
      ["Acme Roofing Inc", "exempt", 9000],
      ["Lawn Guys", "below", 1999.99],
    ]
  );
  const by = Object.fromEntries(rows.map((r) => [r.vendorId, r]));
  assert.match(by.law.why, /attorney/);
  assert.match(by.handy.why, /Get their W-9/);
  assert.equal(by.plumb.why, "1099-NEC due.");
  // A vendor paid nothing that year isn't listed at all.
  assert.equal(by.idle, undefined);
});

test("the same payments in 2025 cross the old $600 line", () => {
  const rows = rows1099(vendors, [pay("mow", 650)], new Set(), 2025);
  assert.deepEqual(rows.map((r) => [r.status, r.why]), [["file", "1099-NEC due — and their W-9 isn't on file, which has the tax ID you'll need."]]);
});

test("cents add up exactly at the line", () => {
  const rows = rows1099(vendors, [pay("mow", 1000.1), pay("mow", 999.9)], new Set(["mow"]), 2026);
  assert.equal(rows[0].status, "file");
  assert.equal(rows[0].total, 2000);
});
