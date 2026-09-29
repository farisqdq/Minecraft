import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  addDays,
  daysFromTo,
  docExpiryNotification,
  dueDateIn,
  leaseEndNotification,
  maintenanceNotification,
  parseDayList,
  parseSettings,
  pickThreshold,
  reminderKey,
  rentDueNotification,
  rentDueSoon,
  rentIsLate,
  rentLateNotification,
  settingsFromRow,
  settingsToRow,
  upcomingRent,
} from "../lib/reminders.ts";

test("a day list is tidied: numbers, no repeats, largest first, at most five", () => {
  assert.deepEqual(parseDayList("60,30", [1]), [60, 30]);
  assert.deepEqual(parseDayList("30, 60 30 x", [1]), [60, 30]);
  assert.deepEqual(parseDayList([7, 400, 0, 1.6], [1]), [7, 2]);
  assert.deepEqual(parseDayList("", [60, 30]), [60, 30], "blank keeps what was there");
  assert.deepEqual(parseDayList("1,2,3,4,5,6,7", [1]), [7, 6, 5, 4, 3]);
});

test("settings from a form fall back field by field, and clamp", () => {
  const s = parseSettings({ enabled: true, rentDue: { days: 45 }, leaseEnd: { days: "90,45,14", tenant: true }, junk: 1 });
  assert.equal(s.enabled, true);
  assert.equal(s.rentDue.days, 31, "a month is the most notice that makes sense");
  assert.equal(s.rentDue.on, true);
  assert.deepEqual(s.leaseEnd.days, [90, 45, 14]);
  assert.equal(s.leaseEnd.tenant, true);
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.equal(parseSettings({ rentLate: { graceDays: -3 } }).rentLate.graceDays, 0);
});

test("settings survive the trip through a database row", () => {
  const s = parseSettings({ enabled: true, docExpiry: { days: [14], push: false } });
  const row = settingsToRow(s);
  assert.equal(row.docExpiryDays, "14");
  assert.equal(row.docExpiryPush, false);
  assert.deepEqual(settingsFromRow(row), s);
});

test("calendar arithmetic is by UTC days", () => {
  assert.equal(addDays("2026-02-27", 3), "2026-03-02");
  assert.equal(daysFromTo("2026-09-28", "2026-10-01"), 3);
  assert.equal(daysFromTo("2026-10-01", "2026-09-28"), -3);
  assert.equal(dueDateIn("2026-02", 31), "2026-02-28");
  assert.equal(dueDateIn("2028-02", 30), "2028-02-29");
  assert.equal(dueDateIn("2026-09", 1), "2026-09-01");
});

test("the next rent day is this month's until it has passed, then next month's", () => {
  assert.deepEqual(upcomingRent("2026-09-28", 1), { month: "2026-10", dueOn: "2026-10-01", daysAway: 3 });
  assert.deepEqual(upcomingRent("2026-09-01", 1), { month: "2026-09", dueOn: "2026-09-01", daysAway: 0 });
  assert.deepEqual(upcomingRent("2026-12-30", 15), { month: "2027-01", dueOn: "2027-01-15", daysAway: 16 });
});

test("rent due soon fires inside the window, and a missed morning still gets one", () => {
  assert.ok(rentDueSoon("2026-09-28", 1, 3), "three days out");
  assert.ok(rentDueSoon("2026-09-30", 1, 3), "would have gone on the 28th; still goes on the 30th");
  assert.equal(rentDueSoon("2026-09-27", 1, 3), null, "four days out is too early");
  assert.ok(rentDueSoon("2026-10-01", 1, 3)?.daysAway === 0, "on the day itself");
});

test("late means the grace period has run out", () => {
  assert.equal(rentIsLate("2026-09-05", "2026-09", 1, 5), false);
  assert.equal(rentIsLate("2026-09-06", "2026-09", 1, 5), true, "the 6th with five days' grace from the 1st");
  assert.equal(rentIsLate("2026-09-02", "2026-09", 1, 0), true, "no grace: late the day after");
  assert.equal(rentIsLate("2026-03-01", "2026-02", 28, 3), false, "Feb 28 + 3 = Mar 3");
  assert.equal(rentIsLate("2026-03-03", "2026-02", 31, 3), true, "the 31st clamps to the 28th");
});

test("the tightest threshold something is inside wins, and past the date there's none", () => {
  assert.equal(pickThreshold(45, [60, 30]), 60);
  assert.equal(pickThreshold(30, [60, 30]), 30);
  assert.equal(pickThreshold(20, [60, 30]), 30);
  assert.equal(pickThreshold(0, [60, 30]), 30);
  assert.equal(pickThreshold(61, [60, 30]), null);
  assert.equal(pickThreshold(-1, [60, 30]), null);
});

test("keys name the thing being reminded about, so a rerun finds its own tracks", () => {
  assert.equal(reminderKey.rentDue("t1", "2026-10"), "rent-due:t1:2026-10");
  assert.equal(reminderKey.leaseEnd("t1", "2026-12-31", 60), "lease-end:t1:2026-12-31:60");
  assert.equal(reminderKey.docExpiry("d1", "2026-10-10", 7), "doc-expiry:d1:2026-10-10:7");
});

test("the rent reminder says how much, where, and when — and what else is owed", () => {
  const n = rentDueNotification({
    tenantName: "Dana Reyes",
    place: "12 Oak St #1",
    company: "Cabinet LLC",
    amount: 875,
    dueOn: "2026-10-01",
    daysAway: 3,
    owed: 120,
    url: "https://eqal.rentals/portal",
  });
  assert.equal(n.subject, "Rent of $875 is due on Oct 1, 2026 — 12 Oak St #1");
  assert.match(n.text, /^Hi Dana —/);
  assert.match(n.text, /\$120 outstanding from before/);
  assert.match(n.text, /Thanks — Cabinet LLC$/);
  assert.ok(n.short.length < 200);
  const tomorrow = rentDueNotification({ ...{ tenantName: "D", place: "P", company: "C", amount: 1, owed: 0, url: "u" }, dueOn: "2026-10-01", daysAway: 1 });
  assert.match(tomorrow.subject, /due tomorrow/);
  assert.doesNotMatch(tomorrow.text, /outstanding from before/);
});

test("the late notice names the amount and how far back it goes", () => {
  const n = rentLateNotification({ tenantName: "Dana", place: "12 Oak St", company: "C", rentOwed: 1750, behindSince: "2026-08", url: "u" });
  assert.match(n.subject, /\$1,750 of rent is past due/);
  assert.match(n.text, /going back to August 2026/);
  assert.match(n.text, /already sent it, please ignore/);
  assert.doesNotMatch(n.text, /late fee/);
});

test("the late notice carries the late-fee clause when one applies", () => {
  const n = rentLateNotification({
    tenantName: "Dana",
    place: "12 Oak St",
    company: "C",
    rentOwed: 1000,
    behindSince: "2026-09",
    lateFee: "a $70 late fee was added; $5/day more until paid, up to $120",
    url: "u",
  });
  // The headline is rent only; the fee is its own sentence, never folded in.
  assert.equal(n.subject, "$1,000 of rent is past due — 12 Oak St");
  assert.equal(
    n.text,
    [
      "Hi Dana —",
      "",
      "$1,000 of rent is past due on 12 Oak St (going back to September 2026). Separately, a $70 late fee was added; $5/day more until paid, up to $120. If you've already sent it, please ignore this.",
      "",
      "Your account: u",
      "",
      "Thanks — C",
    ].join("\n")
  );
  assert.equal(
    n.short,
    "$1,000 of rent is past due on 12 Oak St (going back to September 2026). Separately, a $70 late fee was added; $5/day more until paid, up to $120. If you've already paid, ignore this."
  );
  assert.doesNotMatch(n.text, /1,070/);
});

test("lease and document reminders read differently for the tenant and the landlord", () => {
  const t = leaseEndNotification({ who: "tenant", tenantName: "Dana Reyes", place: "12 Oak St", company: "C", leaseEnd: "2026-12-31", days: 30, url: "u" });
  assert.match(t.text, /^Hi Dana —/);
  assert.match(t.text, /ends in 30 days, on Dec 31, 2026/);
  const l = leaseEndNotification({ who: "landlord", tenantName: "Dana Reyes", place: "12 Oak St", company: "C", leaseEnd: "2026-12-31", days: 0, url: "u" });
  assert.equal(l.subject, "Dana Reyes's lease at 12 Oak St ends today");
  const d = docExpiryNotification({ title: "Liability policy", kind: "Insurance certificate", about: "12 Oak St", expiresOn: "2026-10-05", days: 7, url: "u" });
  assert.equal(d.subject, "Liability policy expires in 7 days");
});

test("a repair update says the new status, or quotes the note", () => {
  const s = maintenanceNotification({ tenantName: "Dana", company: "C", title: "Leaking tap", body: "Scheduled", status: "Scheduled", url: "u" });
  assert.equal(s.subject, "Leaking tap: Scheduled");
  const n = maintenanceNotification({ tenantName: "Dana", company: "C", title: "Leaking tap", body: "Plumber Tuesday 9am", status: "", url: "u" });
  assert.equal(n.subject, "Update on Leaking tap");
  assert.match(n.text, /Plumber Tuesday 9am/);
});
