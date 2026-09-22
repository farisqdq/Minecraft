import test from "node:test";
import assert from "node:assert/strict";
import {
  REMIND_COOLDOWN_HOURS,
  chasedRecently,
  monthName,
  remindedAgo,
  rentNoticeBody,
  smsWithBody,
} from "../lib/notices.ts";

test("a month key becomes something you can say out loud", () => {
  assert.equal(monthName("2026-09"), "September 2026");
  assert.equal(monthName("2026-01"), "January 2026");
  assert.equal(monthName("nonsense"), "");
  assert.equal(monthName(""), "");
});

test("nothing paid: the message names the whole amount", () => {
  const body = rentNoticeBody({
    tenantName: "J. Alvarez",
    month: "2026-09",
    expected: 1550,
    paid: 0,
    company: "Nejad Eqal Rental",
    place: "Woodchuck Ln",
  });
  assert.match(body, /^Hi J\. —/, "opens with a first name, not a full one");
  assert.match(body, /\$1,550 for September 2026 is outstanding on Woodchuck Ln\./);
  assert.match(body, /Nejad Eqal Rental$/, "signed by the LLC, never a person");
  assert.doesNotMatch(body, /1550\b/, "amounts are formatted, not raw");
});

test("part paid: it credits what came in before asking for the rest", () => {
  const body = rentNoticeBody({
    tenantName: "NorthStar Academy LLC",
    month: "2026-09",
    expected: 3379.41,
    paid: 3279.41,
    company: "Nejad Eqal Rental",
    place: "DayCare — Suite 1816",
  });
  // Telling someone who part-paid that they owe the full amount is how you
  // lose a tenant's goodwill, so this wording is load-bearing.
  assert.match(body, /received \$3,279\.41 of the \$3,379\.41 due/);
  assert.match(body, /\$100 is still outstanding/);
  assert.match(body, /DayCare — Suite 1816/);
});

test("the message always leaves room for having crossed in the post", () => {
  const body = rentNoticeBody({
    tenantName: "R. Silva",
    month: "2026-08",
    expected: 1025,
    paid: 0,
    company: "Birchwood Rentals LLC",
    place: "Apt 2",
  });
  assert.match(body, /already sent it, ignore this/i);
});

test("a tenant with no name still gets a sentence", () => {
  const body = rentNoticeBody({
    tenantName: "   ",
    month: "2026-09",
    expected: 900,
    paid: 0,
    company: "An LLC",
    place: "Somewhere",
  });
  assert.match(body, /^Hi there —/);
});

test("the text link carries the message and survives punctuation", () => {
  const href = smsWithBody("(859) 684-4729", "Hi J. — $100 is outstanding. Thanks");
  assert.match(href, /^sms:8596844729\?body=/);
  const body = decodeURIComponent(href.split("body=")[1]);
  assert.equal(body, "Hi J. — $100 is outstanding. Thanks");
  // & and # in a message must not truncate or corrupt the link.
  const tricky = smsWithBody("8596844729", "MO#19-858353734 & MO#19-858353735");
  assert.equal(decodeURIComponent(tricky.split("body=")[1]), "MO#19-858353734 & MO#19-858353735");
  assert.doesNotMatch(tricky.slice("sms:8596844729?body=".length), /[&#]/, "specials are escaped");
});

test("no phone, no link", () => {
  assert.equal(smsWithBody("", "anything"), "");
  assert.equal(smsWithBody("n/a", "anything"), "");
});

test("the cooldown stops you chasing the same person twice in a day", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  assert.equal(chasedRecently(hoursAgo(1), now), true);
  assert.equal(chasedRecently(hoursAgo(REMIND_COOLDOWN_HOURS - 1), now), true);
  assert.equal(chasedRecently(hoursAgo(REMIND_COOLDOWN_HOURS + 1), now), false);
  assert.equal(chasedRecently(undefined, now), false);
  assert.equal(chasedRecently("not a date", now), false);
});

test("how long ago you asked, in words", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");
  const at = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();
  assert.equal(remindedAgo(at(5), now), "just now");
  assert.equal(remindedAgo(at(90), now), "2 hours ago");
  assert.equal(remindedAgo(at(60 * 24), now), "yesterday");
  assert.equal(remindedAgo(at(60 * 24 * 4), now), "4 days ago");
  assert.equal(remindedAgo(at(60 * 24 * 40), now), "a month ago");
  // 45 days is nearer a month and a half, and rounds up rather than down.
  assert.equal(remindedAgo(at(60 * 24 * 45), now), "2 months ago");
  assert.equal(remindedAgo("rubbish", now), "");
});
