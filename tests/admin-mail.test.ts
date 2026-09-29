import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SENDS_PER_ADMIN,
  MAX_SENDS_PER_TARGET,
  adminMailKeys,
  adminResetEmail,
  mailPausedMessage,
  mailResultMessage,
  maskEmail,
} from "../lib/admin-mail.ts";
import { ADMIN_ACTIONS, describeAction } from "../lib/admin.ts";
import { afterFailure, lockedFor } from "../lib/throttle-rules.ts";

test("an address is masked to its first letter and its domain", () => {
  assert.equal(maskEmail("jane.doe@gmail.com"), "j***@gmail.com");
  assert.equal(maskEmail("  Bob@Example.org "), "B***@Example.org");
  assert.equal(maskEmail("a@b.co"), "a***@b.co");
  // Only the last @ separates the domain.
  assert.equal(maskEmail('"odd@name"@host.com'), '"***@host.com');
});

test("something that isn't an address masks to nothing recognisable", () => {
  assert.equal(maskEmail(""), "***");
  assert.equal(maskEmail("nobody"), "***");
  assert.equal(maskEmail("@gmail.com"), "***");
  assert.equal(maskEmail("jane@"), "***");
});

test("three sends per person and twenty per admin, on keys apart from sign-in's", () => {
  assert.equal(MAX_SENDS_PER_TARGET, 3);
  assert.equal(MAX_SENDS_PER_ADMIN, 20);
  assert.deepEqual(adminMailKeys("adm1", "usr9"), [
    { key: "admin-mail:to:usr9", max: 3 },
    { key: "admin-mail:by:adm1", max: 20 },
  ]);
  for (const { key } of adminMailKeys("adm1", "usr9")) {
    assert.ok(!/^(user|tenant|owner|ip):/.test(key));
  }
});

test("the fourth send to one person inside fifteen minutes is paused", () => {
  const t0 = new Date("2026-09-29T12:00:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  let row = afterFailure(null, MAX_SENDS_PER_TARGET, t0);
  assert.equal(lockedFor(row, at(1)), 0);
  row = afterFailure(row, MAX_SENDS_PER_TARGET, at(2));
  assert.equal(lockedFor(row, at(3)), 0);
  row = afterFailure(row, MAX_SENDS_PER_TARGET, at(4)); // the third send goes, and closes the door
  assert.ok(lockedFor(row, at(5)) > 0);
  assert.equal(lockedFor(row, at(20)), 0);
});

test("the paused message gives whole minutes and a way out", () => {
  assert.equal(mailPausedMessage(30), "That's enough emails for now — try again in 1 minute, or copy the link instead.");
  assert.equal(mailPausedMessage(14 * 60 + 1), "That's enough emails for now — try again in 15 minutes, or copy the link instead.");
});

test("each result reads the way the panel promises", () => {
  assert.equal(mailResultMessage({ sent: true }, "j***@gmail.com"), "Sent to j***@gmail.com");
  assert.equal(mailResultMessage({ sent: false, reason: "unconfigured" }, "x"), "Couldn't send — email isn't set up on this site");
  assert.equal(mailResultMessage({ sent: false, reason: "failed" }, "x"), "The mail service refused it; copy the link instead");
});

test("the email says who it's from, what the link does, its limits, and what to do if unexpected", () => {
  const link = "https://eqal.rentals/reset?token=abc";
  const { subject, text } = adminResetEmail(link);
  assert.equal(subject, "Reset your Rent Roll password");
  assert.ok(text.includes(`\n${link}\n`), "the link sits on a line of its own");
  assert.match(text, /Rent Roll site admin/);
  assert.match(text, /set a new password/);
  assert.match(text, /works once and expires in an hour/);
  assert.match(text, /ignore it/);
  assert.match(text, /password hasn't changed/);
  assert.ok(!/<[a-z]/i.test(text), "plain text, no markup");
});

test("the send is an audit action with its own sentence", () => {
  assert.ok((ADMIN_ACTIONS as readonly string[]).includes("account.resetLink.email"));
  assert.equal(
    describeAction({ action: "account.resetLink.email", target: "jane@gmail.com", detail: "sent to j***@gmail.com" }),
    "Emailed the password reset link to jane@gmail.com — sent to j***@gmail.com"
  );
});
