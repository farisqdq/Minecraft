import { test } from "node:test";
import assert from "node:assert/strict";
import { vacancyCost, vacancyStart, vacantDays, vacantFor } from "../lib/vacancy.ts";

const flat = (rent: number) => () => rent;

test("days vacant count from the day it went empty", () => {
  assert.equal(vacantDays("2026-09-01", "2026-09-26"), 25);
  assert.equal(vacantDays("2026-09-26", "2026-09-26"), 0);
  assert.equal(vacantDays("2026-10-01", "2026-09-26"), 0, "a vacancy that hasn't started costs nothing yet");
});

test("the cost is the month's rent spread over its own days", () => {
  // Ten days of a thirty-day month at $1,500 is exactly a third.
  assert.equal(vacancyCost("2026-09-01", "2026-09-11", flat(1500)), 500);
  // A whole month is a whole month's rent, whatever its length.
  assert.equal(vacancyCost("2026-02-01", "2026-03-01", flat(1400)), 1400);
  assert.equal(vacancyCost("2026-09-01", "2026-10-01", flat(1400)), 1400);
});

test("a vacancy across months charges each at that month's rent", () => {
  const rent = (m: string) => (m < "2026-10" ? 1500 : 1600);
  // 15 of September's 30 days, then all of October.
  assert.equal(vacancyCost("2026-09-16", "2026-11-01", rent), 750 + 1600);
});

test("a years-long vacancy adds up without drifting", () => {
  assert.equal(vacancyCost("2024-01-01", "2026-01-01", flat(1000)), 24_000);
});

test("nothing is lost before it starts, or on the day it starts", () => {
  assert.equal(vacancyCost("2026-10-01", "2026-09-26", flat(1500)), 0);
  assert.equal(vacancyCost("2026-09-26", "2026-09-26", flat(1500)), 0);
});

test("the loss starts when rent stops, not when they hand back the keys", () => {
  // Left on the 26th having been charged for September: the vacancy costs
  // nothing until October.
  assert.equal(vacancyStart("2026-09-26", "2026-09"), "2026-10-01");
  // Left on the 26th, charged only through August: September is lost from
  // the day they left.
  assert.equal(vacancyStart("2026-09-26", "2026-08"), "2026-09-26");
  // Year end rolls over.
  assert.equal(vacancyStart("2026-12-20", "2026-12"), "2027-01-01");
});

test("durations read at the precision anyone thinks in", () => {
  assert.equal(vacantFor(0), "from today");
  assert.equal(vacantFor(1), "1 day");
  assert.equal(vacantFor(13), "13 days");
  assert.equal(vacantFor(20), "2 weeks");
  assert.equal(vacantFor(75), "2 months");
  assert.equal(vacantFor(800), "2 years");
});
