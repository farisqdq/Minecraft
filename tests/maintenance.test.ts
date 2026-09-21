import test from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_STATUSES,
  REQUEST_CATEGORIES,
  STATUSES,
  STATUS_LABEL,
  ago,
  isOpen,
  normalizeCategory,
  normalizeStatus,
  text,
} from "../lib/maintenance.ts";

test("a category survives however the tenant's browser cased it", () => {
  assert.equal(normalizeCategory("Plumbing"), "Plumbing");
  assert.equal(normalizeCategory("plumbing"), "Plumbing");
  assert.equal(normalizeCategory("  HEATING / AC  "), "Heating / AC");
});

test("an unknown category is refused rather than guessed at", () => {
  assert.equal(normalizeCategory("Teleportation"), null);
  assert.equal(normalizeCategory(""), null);
  assert.equal(normalizeCategory(null), null);
  assert.equal(normalizeCategory(42), null);
});

test("the category list covers commercial tenants, not just houses", () => {
  // A laundromat's parking lot and a storefront's sign are the two that a
  // residential-only list always misses.
  for (const needed of ["Parking lot / exterior", "Signage", "Common area"]) {
    assert.ok(
      (REQUEST_CATEGORIES as readonly string[]).includes(needed),
      `missing category: ${needed}`
    );
  }
});

test("a status is only ever one of the five", () => {
  for (const s of STATUSES) assert.equal(normalizeStatus(s), s);
  assert.equal(normalizeStatus("in progress"), null);
  assert.equal(normalizeStatus("OPEN"), null);
  assert.equal(normalizeStatus(undefined), null);
});

test("open means the landlord still owes an answer", () => {
  assert.equal(isOpen("open"), true);
  assert.equal(isOpen("seen"), true);
  assert.equal(isOpen("scheduled"), true);
  assert.equal(isOpen("done"), false);
  assert.equal(isOpen("declined"), false);
  // A status from a tampered request body must not read as open.
  assert.equal(isOpen("nonsense"), false);
});

test("every status reads differently to each side", () => {
  for (const s of STATUSES) {
    const label = STATUS_LABEL[s];
    assert.ok(label.tenant.length > 0, `${s} has no tenant wording`);
    assert.ok(label.landlord.length > 0, `${s} has no landlord wording`);
  }
  // The tenant's question is "is anyone doing anything", so their wording
  // says who has done what; the landlord's is a queue label.
  assert.equal(STATUS_LABEL.open.landlord, "New");
  assert.match(STATUS_LABEL.open.tenant, /not looked at/i);
  assert.equal(OPEN_STATUSES.length, 3);
});

test("relative time reads the way someone would say it", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");
  const at = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();
  assert.equal(ago(at(0), now), "just now");
  assert.equal(ago(at(1), now), "1 min ago");
  assert.equal(ago(at(45), now), "45 min ago");
  assert.equal(ago(at(60), now), "an hour ago");
  assert.equal(ago(at(60 * 5), now), "5 hours ago");
  assert.equal(ago(at(60 * 24), now), "yesterday");
  assert.equal(ago(at(60 * 24 * 3), now), "3 days ago");
  assert.equal(ago(at(60 * 24 * 40), now), "a month ago");
  assert.equal(ago(at(60 * 24 * 200), now), "7 months ago");
});

test("relative time doesn't blow up on a bad date", () => {
  assert.equal(ago("not a date", new Date()), "");
  assert.equal(ago("", new Date()), "");
});

test("text trims, caps, and refuses anything that isn't a string", () => {
  assert.equal(text("  leaky tap  ", 40), "leaky tap");
  assert.equal(text("x".repeat(200), 10), "x".repeat(10));
  assert.equal(text(undefined, 10), "");
  assert.equal(text(123, 10), "");
  assert.equal(text({ toString: () => "sneaky" }, 10), "");
});
