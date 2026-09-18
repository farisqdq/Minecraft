import { test } from "node:test";
import assert from "node:assert/strict";
import { rentForMonth, historyFor, monthStart, monthKeyOf, type RentChangeDTO } from "../lib/rent.ts";

const change = (
  effectiveFrom: string,
  amount: number,
  propertyId = "p1",
  unitId: string | null = null
): RentChangeDTO => ({ id: effectiveFrom + amount, propertyId, unitId, effectiveFrom, amount });

test("with no history, every month uses the current rent", () => {
  assert.equal(rentForMonth([], "p1", null, "2024-03", 1450), 1450);
  assert.equal(rentForMonth([], "p1", null, "2030-12", 1450), 1450);
});

test("a raise does not reach backwards", () => {
  // The bug this exists to prevent: a year of correctly paid rent reading as
  // short because the rent went up in January.
  const changes = [change("2020-01", 1450), change("2026-01", 1550)];
  assert.equal(rentForMonth(changes, "p1", null, "2025-06", 1550), 1450);
  assert.equal(rentForMonth(changes, "p1", null, "2025-12", 1550), 1450);
  assert.equal(rentForMonth(changes, "p1", null, "2026-01", 1550), 1550, "effective from its own month");
  assert.equal(rentForMonth(changes, "p1", null, "2026-07", 1550), 1550);
});

test("months before the earliest change fall back to the current figure", () => {
  const changes = [change("2026-01", 1550)];
  assert.equal(rentForMonth(changes, "p1", null, "2025-11", 1450), 1450);
});

test("the latest applicable change wins out of order", () => {
  const changes = [change("2026-01", 1550), change("2020-01", 1200), change("2023-06", 1450)];
  assert.equal(rentForMonth(changes, "p1", null, "2024-01", 9999), 1450);
});

test("a unit's history is its own, never the property's", () => {
  const changes = [
    change("2026-01", 1550, "p1", null),
    change("2026-01", 990, "p1", "u1"),
    change("2026-01", 1080, "p1", "u2"),
  ];
  assert.equal(rentForMonth(changes, "p1", "u1", "2026-03", 0), 990);
  assert.equal(rentForMonth(changes, "p1", "u2", "2026-03", 0), 1080);
  assert.equal(rentForMonth(changes, "p1", null, "2026-03", 0), 1550, "whole property");
});

test("one property's history never leaks into another's", () => {
  const changes = [change("2026-01", 1550, "p1"), change("2026-01", 2400, "p2")];
  assert.equal(rentForMonth(changes, "p2", null, "2026-05", 0), 2400);
});

test("a rent drop is handled the same as a rise", () => {
  const changes = [change("2020-01", 1600), change("2025-03", 1400)];
  assert.equal(rentForMonth(changes, "p1", null, "2025-02", 1400), 1600);
  assert.equal(rentForMonth(changes, "p1", null, "2025-03", 1400), 1400);
});

test("history reads newest first and is scoped to one place", () => {
  const changes = [change("2020-01", 1200), change("2026-01", 1550), change("2026-01", 990, "p1", "u1")];
  const h = historyFor(changes, "p1", null);
  assert.deepEqual(h.map((c) => c.amount), [1550, 1200]);
});

test("a month key maps to the first of that month in UTC and back", () => {
  assert.equal(monthStart("2026-09").toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(monthKeyOf(monthStart("2026-09")), "2026-09");
});
