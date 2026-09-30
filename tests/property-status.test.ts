import { test } from "node:test";
import assert from "node:assert/strict";
import { propertyStatus, type PlaceMonth } from "../lib/property-status.ts";

const place = (p: Partial<PlaceMonth> = {}): PlaceMonth => ({
  vacant: false,
  rent: 1000,
  paid: 0,
  fees: 0,
  daysLate: 0,
  leaseEnded: false,
  ...p,
});

test("no occupied place is vacant", () => {
  assert.equal(propertyStatus([]), "vacant");
  assert.equal(propertyStatus([place({ vacant: true }), place({ vacant: true, paid: 5 })]), "vacant");
});

test("rent plus the month's late fees must be covered to be paid", () => {
  assert.equal(propertyStatus([place({ paid: 1000 })]), "paid");
  assert.equal(propertyStatus([place({ paid: 1000, fees: 50, daysLate: 6 })]), "late");
  assert.equal(propertyStatus([place({ paid: 1050, fees: 50, daysLate: 6 })]), "paid");
});

test("past the due day and short is late, even when some came in", () => {
  assert.equal(propertyStatus([place({ daysLate: 1 })]), "late");
  assert.equal(propertyStatus([place({ paid: 400, daysLate: 3 })]), "late");
  assert.equal(propertyStatus([place({ paid: 1000 }), place({ daysLate: 2 })]), "late");
});

test("something in but not all, before the due day, is partial", () => {
  assert.equal(propertyStatus([place({ paid: 400 })]), "partial");
  assert.equal(propertyStatus([place({ paid: 1000 }), place()]), "partial");
});

test("owed with nothing in and not yet late is due", () => {
  assert.equal(propertyStatus([place({ daysLate: 0 })]), "due");
  assert.equal(propertyStatus([place({ daysLate: -4 })]), "due");
});

test("lease ended shows unless money is late or partial", () => {
  assert.equal(propertyStatus([place({ leaseEnded: true, paid: 1000 })]), "ended");
  assert.equal(propertyStatus([place({ leaseEnded: true })]), "ended");
  assert.equal(propertyStatus([place({ leaseEnded: true, daysLate: 3 })]), "late");
  assert.equal(propertyStatus([place({ leaseEnded: true }), place({ paid: 1000 })]), "partial");
  assert.equal(propertyStatus([place({ leaseEnded: true, paid: 1000 }), place({ paid: 1000 })]), "paid");
});

test("let with no rent set is none; vacant units are ignored", () => {
  assert.equal(propertyStatus([place({ rent: 0 })]), "none");
  assert.equal(propertyStatus([place({ paid: 1000 }), place({ vacant: true })]), "paid");
});
