import test from "node:test";
import assert from "node:assert/strict";
import { byUrgency, daysUntil, expiryLabel, expiryState, normalizeKind, SOON_DAYS } from "../lib/documents.ts";

const fmt = (iso: string) => `[${iso}]`;

test("kinds are matched loosely, including the American spelling", () => {
  assert.equal(normalizeKind("lease"), "Lease");
  assert.equal(normalizeKind("Business license"), "Business licence");
  assert.equal(normalizeKind("insurance CERTIFICATE"), "Insurance certificate");
  assert.equal(normalizeKind("a napkin"), "Other");
  assert.equal(normalizeKind(null), "Other");
});

test("days are counted as calendar days, across month and year ends", () => {
  assert.equal(daysUntil("2026-10-01", "2026-09-30"), 1);
  assert.equal(daysUntil("2027-01-01", "2026-12-31"), 1);
  assert.equal(daysUntil("2026-09-22", "2026-09-22"), 0);
  assert.equal(daysUntil("2026-09-20", "2026-09-22"), -2);
  // A leap day.
  assert.equal(daysUntil("2028-03-01", "2028-02-28"), 2);
  assert.equal(daysUntil("", "2026-09-22"), null);
  assert.equal(daysUntil("next tuesday", "2026-09-22"), null);
});

test("a document is good through the day it names", () => {
  assert.equal(expiryState("2026-09-22", "2026-09-22"), "soon", "today is not expired yet");
  assert.equal(expiryState("2026-09-21", "2026-09-22"), "expired");
});

test("the soon window is exactly SOON_DAYS", () => {
  assert.equal(expiryState("2026-10-22", "2026-09-22"), "soon", `${SOON_DAYS} days out still counts`);
  assert.equal(expiryState("2026-10-23", "2026-09-22"), "ok");
  assert.equal(expiryState("", "2026-09-22"), "none");
});

test("labels read the way a person would say them", () => {
  const t = "2026-09-22";
  assert.equal(expiryLabel("2026-09-19", t, fmt), "Expired 3 days ago");
  assert.equal(expiryLabel("2026-09-21", t, fmt), "Expired yesterday");
  assert.equal(expiryLabel("2026-09-22", t, fmt), "Expires today");
  assert.equal(expiryLabel("2026-09-23", t, fmt), "Expires tomorrow");
  assert.equal(expiryLabel("2026-10-04", t, fmt), "Expires in 12 days");
  assert.equal(expiryLabel("2027-03-01", t, fmt), "Good until [2027-03-01]");
  assert.equal(expiryLabel("", t, fmt), "No expiry");
});

test("the most urgent comes first", () => {
  const t = "2026-09-22";
  const docs = [
    { id: "never", expiresOn: "" },
    { id: "later", expiresOn: "2027-06-01" },
    { id: "soon2", expiresOn: "2026-10-10" },
    { id: "gone", expiresOn: "2026-08-01" },
    { id: "soon1", expiresOn: "2026-09-25" },
  ];
  assert.deepEqual(byUrgency(docs, t).map((d) => d.id), ["gone", "soon1", "soon2", "later", "never"]);
});
