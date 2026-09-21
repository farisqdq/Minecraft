import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dueDateFor,
  daysLate,
  daysUntilLeaseEnd,
  leaseStatus,
  leaseRange,
  formatDay,
  telHref,
  smsHref,
  isoDay,
  dateFromISO,
  formatPhone,
} from "../lib/lease.ts";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

test("rent is due on the day the lease says", () => {
  assert.deepEqual(dueDateFor("2026-09", 1), at(2026, 9, 1));
  assert.deepEqual(dueDateFor("2026-09", 15), at(2026, 9, 15));
});

test("a due day past the end of a short month lands on its last day", () => {
  // "the 31st" in February means end of February, not a date that doesn't exist.
  assert.deepEqual(dueDateFor("2026-02", 31), at(2026, 2, 28));
  assert.deepEqual(dueDateFor("2024-02", 31), at(2024, 2, 29), "leap year");
  assert.deepEqual(dueDateFor("2026-04", 31), at(2026, 4, 30), "30-day month");
});

test("a due day below 1 is clamped rather than rolling into the previous month", () => {
  assert.deepEqual(dueDateFor("2026-09", 0), at(2026, 9, 1));
  assert.deepEqual(dueDateFor("2026-09", -5), at(2026, 9, 1));
});

test("days late counts from the due date", () => {
  assert.equal(daysLate("2026-09", 1, at(2026, 9, 18)), 17);
  assert.equal(daysLate("2026-09", 5, at(2026, 9, 18)), 13);
});

test("rent is not late on the day it is due, or before it", () => {
  assert.equal(daysLate("2026-09", 5, at(2026, 9, 5)), 0);
  assert.ok(daysLate("2026-09", 5, at(2026, 9, 1)) < 0, "not yet due reads negative");
});

test("days late spans month and year boundaries", () => {
  assert.equal(daysLate("2025-12", 1, at(2026, 1, 1)), 31);
});

test("lease countdown is null when no end date is on file", () => {
  assert.equal(daysUntilLeaseEnd(""), null);
  assert.equal(daysUntilLeaseEnd("not-a-date"), null);
});

test("lease status reflects how close the end is", () => {
  const now = at(2026, 9, 18);
  const lease = (leaseEnd: string, active = true) => ({ dueDay: 1, leaseStart: "", leaseEnd, active });

  assert.equal(leaseStatus(lease("", false), now).kind, "past");
  assert.equal(leaseStatus(lease(""), now).kind, "ok", "no end date is not a warning");
  assert.equal(leaseStatus(lease("2027-09-18"), now).kind, "ok", "a year out is not a warning");
  assert.equal(leaseStatus(lease("2026-10-14"), now).kind, "ending");
  assert.equal(leaseStatus(lease("2026-10-14"), now).label, "Ends in 26 days");
  assert.equal(leaseStatus(lease("2026-09-19"), now).label, "Ends tomorrow");
  assert.equal(leaseStatus(lease("2026-09-18"), now).label, "Ends today");
  assert.equal(leaseStatus(lease("2026-09-01"), now).kind, "expired");
});

test("the 60-day warning window is inclusive at its edge", () => {
  const now = at(2026, 1, 1);
  const lease = (leaseEnd: string) => ({ dueDay: 1, leaseStart: "", leaseEnd, active: true });
  assert.equal(leaseStatus(lease("2026-03-02"), now).kind, "ending", "exactly 60 days out");
  assert.equal(leaseStatus(lease("2026-03-03"), now).kind, "ok", "61 days out");
});

test("a lease range reads sensibly with either half missing", () => {
  assert.equal(leaseRange("2025-01-01", "2026-12-31"), "Jan 1, 2025 – Dec 31, 2026");
  assert.equal(leaseRange("2023-02-01", ""), "From Feb 1, 2023");
  assert.equal(leaseRange("", "2026-12-31"), "Until Dec 31, 2026");
  assert.equal(leaseRange("", ""), "Not recorded");
});

test("a date string renders as a local day, not shifted by a timezone", () => {
  // Parsed as local midnight: a UTC parse would render Dec 31 west of GMT.
  assert.equal(formatDay("2026-01-01"), "Jan 1, 2026");
  assert.equal(formatDay(""), "—");
});

test("isoDay and dateFromISO round-trip", () => {
  assert.equal(isoDay(at(2026, 9, 5)), "2026-09-05");
  assert.equal(isoDay(dateFromISO("2026-09-05")), "2026-09-05");
});

test("phone links strip the formatting people type", () => {
  assert.equal(telHref("(555) 010-4477"), "tel:5550104477");
  assert.equal(smsHref("+1 555 010 4477"), "sms:+15550104477");
  assert.equal(telHref(""), "", "no number means no link");
  assert.equal(telHref("n/a"), "", "nothing dialable means no link");
});

test("a bare ten-digit number is shaped for reading; anything else is left alone", () => {
  assert.equal(formatPhone("8596844729"), "(859) 684-4729");
  assert.equal(formatPhone(" 8596844729 "), "(859) 684-4729");
  assert.equal(formatPhone("18596844729"), "(859) 684-4729");
  // Already punctuated, or not a plain US number: not ours to reshape.
  assert.equal(formatPhone("(859) 684-4729"), "(859) 684-4729");
  assert.equal(formatPhone("859-684-4729"), "859-684-4729");
  assert.equal(formatPhone("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(formatPhone("8596844729 ext 4"), "8596844729 ext 4");
  assert.equal(formatPhone(""), "");
});
