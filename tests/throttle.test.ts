import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCK_MS,
  MAX_PER_ACCOUNT,
  MAX_PER_IP,
  WINDOW_MS,
  accountKey,
  afterFailure,
  clientIp,
  ipKey,
  lockedFor,
  pauseMessage,
} from "../lib/throttle-rules.ts";

const T0 = new Date("2026-09-21T12:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

test("the first wrong password starts a count of one, unpaused", () => {
  const row = afterFailure(null, MAX_PER_ACCOUNT, T0);
  assert.equal(row.failures, 1);
  assert.deepEqual(row.windowStart, T0);
  assert.equal(row.lockedUntil, null);
  assert.equal(lockedFor(row, T0), 0);
});

test("wrong passwords inside the window add up; the tenth pauses the account", () => {
  let row = afterFailure(null, MAX_PER_ACCOUNT, T0);
  for (let i = 2; i < MAX_PER_ACCOUNT; i++) {
    row = afterFailure(row, MAX_PER_ACCOUNT, later(i * 1000));
    assert.equal(row.failures, i);
    assert.equal(row.lockedUntil, null, `paused early at ${i}`);
  }
  row = afterFailure(row, MAX_PER_ACCOUNT, later(10_000));
  assert.equal(row.failures, MAX_PER_ACCOUNT);
  assert.deepEqual(row.lockedUntil, later(10_000 + LOCK_MS));
});

test("a pause lasts fifteen minutes and then lifts on its own", () => {
  const row = { failures: 10, windowStart: T0, lockedUntil: later(LOCK_MS) };
  assert.equal(lockedFor(row, T0), LOCK_MS / 1000);
  assert.equal(lockedFor(row, later(LOCK_MS - 1000)), 1);
  assert.equal(lockedFor(row, later(LOCK_MS)), 0);
  assert.equal(lockedFor(row, later(LOCK_MS + 60_000)), 0);
});

test("a wrong password after the window has passed starts over", () => {
  const stale = { failures: 9, windowStart: T0, lockedUntil: null };
  const row = afterFailure(stale, MAX_PER_ACCOUNT, later(WINDOW_MS + 1));
  assert.equal(row.failures, 1, "nine old misses must not carry over");
  assert.deepEqual(row.windowStart, later(WINDOW_MS + 1));
  assert.equal(row.lockedUntil, null);
});

test("a fresh window does not wipe a pause that is still running", () => {
  // Paused at T0 for fifteen minutes; the window also happens to roll over.
  const paused = { failures: 10, windowStart: later(-WINDOW_MS - 1), lockedUntil: later(LOCK_MS) };
  const row = afterFailure(paused, MAX_PER_ACCOUNT, T0);
  assert.equal(row.failures, 1);
  assert.deepEqual(row.lockedUntil, later(LOCK_MS), "the pause must survive the reset");
});

test("the address ceiling is looser than the account one", () => {
  assert.ok(MAX_PER_IP > MAX_PER_ACCOUNT);
  let row = afterFailure(null, MAX_PER_IP, T0);
  for (let i = 2; i < MAX_PER_IP; i++) row = afterFailure(row, MAX_PER_IP, later(i));
  assert.equal(row.lockedUntil, null);
  row = afterFailure(row, MAX_PER_IP, later(MAX_PER_IP));
  assert.ok(row.lockedUntil);
});

test("keys are case-blind on the email and distinct per door", () => {
  assert.equal(accountKey("user", "  Faris@Example.COM "), "user:faris@example.com");
  assert.equal(accountKey("tenant", "faris@example.com"), "tenant:faris@example.com");
  assert.notEqual(accountKey("user", "a@b.c"), accountKey("tenant", "a@b.c"));
  assert.equal(ipKey("203.0.113.9"), "ip:203.0.113.9");
  assert.equal(ipKey(null), null);
});

test("the client address is the first hop, and absent means no address rule", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIp({ "x-forwarded-for": " 198.51.100.4 " }), "198.51.100.4");
  assert.equal(clientIp({ "X-Forwarded-For": "198.51.100.4" }), "198.51.100.4");
  assert.equal(clientIp(new Headers()), null);
  assert.equal(clientIp(undefined), null);
  assert.equal(clientIp({ "x-forwarded-for": 42 }), null, "a non-string header is ignored");
  // A hostile header can't blow the key up to any length.
  assert.equal(clientIp({ "x-forwarded-for": "a".repeat(500) })?.length, 64);
});

test("the pause message never says zero minutes", () => {
  assert.equal(pauseMessage(1), "Too many attempts. Try again in 1 minute.");
  assert.equal(pauseMessage(60), "Too many attempts. Try again in 1 minute.");
  assert.equal(pauseMessage(61), "Too many attempts. Try again in 2 minutes.");
  assert.equal(pauseMessage(900), "Too many attempts. Try again in 15 minutes.");
});
