import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  changeSummary,
  dueDayLong,
  dueRentFlips,
  noticeBy,
  parseRenewal,
  raiseOptions,
  renewalDefaults,
  renewalMessage,
  roundRent,
} from "../lib/renewal.ts";
import { rentForMonth } from "../lib/rent.ts";

test("a lease ending this year renews for a year, the new rent from the month after it ends", () => {
  assert.deepEqual(renewalDefaults({ leaseEnd: "2026-12-31", today: "2026-10-03" }), { newEnd: "2027-12-31", rentFrom: "2027-01" });
  assert.deepEqual(renewalDefaults({ leaseEnd: "2026-11-14", today: "2026-10-03" }), { newEnd: "2027-11-14", rentFrom: "2026-12" });
  // A leap day lands on the 28th rather than rolling into March.
  assert.deepEqual(renewalDefaults({ leaseEnd: "2028-02-29", today: "2028-01-10" }).newEnd, "2029-02-28");
});

test("a lease already ended, or with no end on file, renews from next month for twelve months", () => {
  assert.deepEqual(renewalDefaults({ leaseEnd: "2026-08-31", today: "2026-10-03" }), { newEnd: "2027-10-31", rentFrom: "2026-11" });
  assert.deepEqual(renewalDefaults({ leaseEnd: "", today: "2026-12-15" }), { newEnd: "2027-12-31", rentFrom: "2027-01" });
});

test("months add across year ends", () => {
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-05", 24), "2028-05");
});

test("raises are quoted to the nearest $5, and a raise that rounds to nothing isn't offered", () => {
  assert.equal(roundRent(1493.5), 1495);
  assert.deepEqual(raiseOptions(1450), [
    { label: "Keep $1,450", amount: 1450 },
    { label: "+3%", amount: 1495 },
    { label: "+5%", amount: 1525 },
  ]);
  // On $40 a 3% or 5% raise rounds back to $40: only "Keep" is offered.
  assert.deepEqual(raiseOptions(40).map((o) => o.amount), [40]);
  assert.deepEqual(raiseOptions(0), []);
});

test("the change reads as a month, a year and a percentage", () => {
  assert.equal(changeSummary(1450, 1525), "+$75 a month · +$900 a year · +5.2%");
  assert.equal(changeSummary(1500, 1450), "−$50 a month · −$600 a year · −3.3%");
  assert.equal(changeSummary(1450, 1450), "Rent stays the same.");
});

test("notice is due thirty days before the new rent's month begins", () => {
  assert.equal(noticeBy("2027-01"), "2026-12-02");
  assert.equal(noticeBy("2027-03", 60), "2026-12-31");
});

test("a renewal is refused when it would end before the current lease or re-judge a past month", () => {
  const ctx = { previousEnd: "2026-12-31", today: "2026-10-03" };
  const ok = parseRenewal({ newEnd: "2027-12-31", newRent: "1525", rentFrom: "2027-01", note: "  " }, ctx);
  assert.deepEqual(ok, { ok: true, value: { newEnd: "2027-12-31", newRent: 1525, rentFrom: "2027-01", note: "" } });
  const bad = (body: object, why: RegExp) => {
    const r = parseRenewal(body, ctx);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, why);
  };
  bad({ newEnd: "2026-11-30", newRent: 1525, rentFrom: "2026-11" }, /after the current one/);
  bad({ newEnd: "2027-12-31", newRent: 1525, rentFrom: "2026-09" }, /already passed/);
  bad({ newEnd: "2027-12-31", newRent: 0, rentFrom: "2027-01" }, /monthly rent/);
  bad({ newEnd: "2027-12-31", newRent: 1525, rentFrom: "2028-02" }, /before the renewed lease ends/);
  bad({ newEnd: "2027-02-30", newRent: 1525, rentFrom: "2027-01" }, /Choose the date/);
  bad({ newEnd: "2027-12-31", newRent: 1525, rentFrom: "2027-13" }, /month the new rent starts/);
  // This month is allowed: a raise agreed today for rent not yet due.
  assert.equal(parseRenewal({ newEnd: "2027-12-31", newRent: 1525, rentFrom: "2026-10" }, ctx).ok, true);
});

test("a raise written ahead is in force from its month and not a month before", () => {
  // What a renewal writes: the old figure since forever, the new from January.
  const changes = [
    { id: "a", propertyId: "p", unitId: null, effectiveFrom: "1970-01", amount: 1450 },
    { id: "b", propertyId: "p", unitId: null, effectiveFrom: "2027-01", amount: 1525 },
  ];
  // The fallback is today's figure, which still reads 1450 until the flip.
  assert.equal(rentForMonth(changes, "p", null, "2026-12", 1450), 1450);
  assert.equal(rentForMonth(changes, "p", null, "2027-01", 1450), 1525);
  assert.equal(rentForMonth(changes, "p", null, "2027-06", 1450), 1525);
});

test("a due change flips the current rent, unless a later edit already set it", () => {
  const due = [
    { id: "s1", propertyId: "p", unitId: null, effectiveFrom: "2026-12", amount: 1500 },
    { id: "s2", propertyId: "p", unitId: null, effectiveFrom: "2027-01", amount: 1525 },
    { id: "s3", propertyId: "q", unitId: "u", effectiveFrom: "2027-01", amount: 900 },
  ];
  const flips = dueRentFlips(due, new Map([["p|", { id: "s2" }], ["q|u", { id: "manual" }]]));
  assert.deepEqual(flips, [
    { propertyId: "p", unitId: null, amount: 1525, ids: ["s1", "s2"] },
    { propertyId: "q", unitId: "u", amount: null, ids: ["s3"] },
  ]);
});

test("the due day in a letter never runs past the month's end", () => {
  assert.equal(dueDayLong("2027-02", 31), "February 28, 2027");
  assert.equal(dueDayLong("2027-01", 5), "January 5, 2027");
  assert.equal(dueDayLong("2027-01"), "January 1, 2027");
});

test("the renewal message says what changes and from when, and nothing else", () => {
  const text = renewalMessage({
    tenantName: "Alan D Ward",
    place: "12 Oak St",
    previousEnd: "2026-12-31",
    newEnd: "2027-12-31",
    previousRent: 1450,
    newRent: 1525,
    rentFrom: "2027-01",
    dueDay: 1,
    companyName: "Birchwood Holdings LLC",
    note: "",
  });
  assert.equal(
    text,
    [
      "Hi Alan,",
      "",
      "Your lease at 12 Oak St, which runs to December 31, 2026, is renewed through December 31, 2027.",
      "Starting with the rent due January 1, 2027, the monthly rent will be $1,525 (it is $1,450 now).",
      "Everything else in your lease stays the same.",
      "",
      "— Birchwood Holdings LLC",
    ].join("\n")
  );
  const same = renewalMessage({
    tenantName: "Maria Lopez",
    place: "Elm Duplex, A",
    previousEnd: "",
    newEnd: "2027-08-31",
    previousRent: 900,
    newRent: 900,
    rentFrom: "2026-11",
    dueDay: 5,
    companyName: "Birchwood",
    note: "Thanks for being a great tenant.",
  });
  assert.match(same, /^Hi Maria,\n\nYour lease at Elm Duplex, A is renewed through August 31, 2027\.\nThe rent stays at \$900 a month\./);
  assert.match(same, /Thanks for being a great tenant\.\n\n— Birchwood$/);
});
