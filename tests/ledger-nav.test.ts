import { test } from "node:test";
import assert from "node:assert/strict";
import { initialsOf, isNavOn } from "../lib/layouts/ledger-nav.ts";
import { dayLabel, monthName, shortMonth } from "../lib/layouts/ledger-format.ts";

test("month and day labels", () => {
  assert.equal(monthName("2026-09"), "September 2026");
  assert.equal(monthName("2026-09", false), "September");
  assert.equal(shortMonth("2026-01"), "Jan");
  assert.equal(dayLabel("2026-09-04"), "Sep 4, 2026");
});

test("Overview is only on for the overview itself", () => {
  assert.equal(isNavOn("/dashboard", "/dashboard"), true);
  assert.equal(isNavOn("/dashboard/repairs", "/dashboard"), false);
});

test("sections own their nested pages, not look-alike prefixes", () => {
  assert.equal(isNavOn("/dashboard/repairs/vendors", "/dashboard/repairs"), true);
  assert.equal(isNavOn("/dashboard/files", "/dashboard/files"), true);
  assert.equal(isNavOn("/dashboard/filesx", "/dashboard/files"), false);
});

test("Properties links to the rent roll but owns property pages", () => {
  assert.equal(isNavOn("/dashboard/properties/abc", "/dashboard#rent-roll", "/dashboard/properties"), true);
  assert.equal(isNavOn("/dashboard", "/dashboard#rent-roll", "/dashboard/properties"), false);
});

test("initials from a name or an email", () => {
  assert.equal(initialsOf("Dana Whitfield"), "DW");
  assert.equal(initialsOf("Dana Q. Whitfield"), "DW");
  assert.equal(initialsOf("landlord@demo.local"), "L");
  assert.equal(initialsOf("  "), "?");
});
