import test from "node:test";
import assert from "node:assert/strict";
import {
  capFor,
  cardLateFeeLine,
  isPaidUp,
  mergedFees,
  needsStatusCheck,
  noFeeLine,
  parseStatuses,
  shortAmount,
} from "../lib/late-fee-card.ts";
import type { LateFeePolicyDTO } from "../lib/late-fee-policy.ts";

const LLC: LateFeePolicyDTO = { enabled: true, graceDays: 5, percent: 7, dailyAmount: 5, capPercent: 12 };

test("the worked example: 7% of $4,570 against a 12% cap", () => {
  assert.equal(capFor(LLC, 4570), 548.4);
  assert.equal(
    cardLateFeeLine({ fees: 319.9, rent: 4570, policy: LLC, mode: "default" }),
    "Late fees $319.90 (7% + $5/day, cap $548.40) · 58% of cap"
  );
});

test("fees at the cap say so instead of 100%", () => {
  assert.equal(
    cardLateFeeLine({ fees: 548.4, rent: 4570, policy: LLC, mode: "default" }),
    "Late fees $548.40 (7% + $5/day, cap $548.40) · cap reached"
  );
  // A cent under the cap is not reached, and floors rather than rounding up.
  assert.equal(
    cardLateFeeLine({ fees: 548.3, rent: 4570, policy: LLC, mode: "default" }),
    "Late fees $548.30 (7% + $5/day, cap $548.40) · 99% of cap"
  );
});

test("zero parts of the policy are left out", () => {
  assert.equal(
    cardLateFeeLine({ fees: 319.9, rent: 4570, policy: { ...LLC, dailyAmount: 0 }, mode: "default" }),
    "Late fees $319.90 (7%, cap $548.40) · 58% of cap"
  );
  assert.equal(
    cardLateFeeLine({ fees: 319.9, rent: 4570, policy: { ...LLC, capPercent: 0 }, mode: "default" }),
    "Late fees $319.90 (7% + $5/day)"
  );
  assert.equal(
    cardLateFeeLine({ fees: 25, rent: 1000, policy: { ...LLC, percent: 0, capPercent: 0 }, mode: "default" }),
    "Late fees $25 ($5/day)"
  );
});

test("a tenant on their own rules gets the bare amount", () => {
  assert.equal(cardLateFeeLine({ fees: 319.9, rent: 4570, policy: LLC, mode: "custom" }), "Late fees $319.90");
  assert.equal(cardLateFeeLine({ fees: 50, rent: 1000, policy: null, mode: "default" }), "Late fees $50");
});

test("no fees, no line", () => {
  assert.equal(cardLateFeeLine({ fees: 0, rent: 4570, policy: LLC, mode: "default" }), "");
});

test("short amount includes the month's fees", () => {
  assert.equal(shortAmount({ rent: 4570, paid: 0, fees: 319.9 }), 4889.9);
  assert.equal(shortAmount({ rent: 4570, paid: 2000, fees: 319.9 }), 2889.9);
  assert.equal(shortAmount({ rent: 4570, paid: 5000, fees: 319.9 }), 0);
  assert.equal(isPaidUp({ rent: 4570, paid: 4889.9, fees: 319.9 }), true);
});

test("rent paid in full with fees still open is short, not paid", () => {
  assert.equal(isPaidUp({ rent: 4570, paid: 4570, fees: 319.9 }), false);
  assert.equal(shortAmount({ rent: 4570, paid: 4570, fees: 319.9 }), 319.9);
  assert.equal(isPaidUp({ rent: 4570, paid: 4570, fees: 0 }), true);
  assert.equal(isPaidUp({ rent: 0, paid: 0, fees: 0 }), false);
});

const base = { rent: 1000, paid: 0, fees: 0, dueDay: 1, graceDays: 5, month: "2026-09" };

test("status check waits out the grace period: day 5 no, day 6 yes", () => {
  assert.equal(needsStatusCheck({ ...base, today: "2026-09-05" }), false);
  assert.equal(needsStatusCheck({ ...base, today: "2026-09-06" }), true);
  assert.equal(needsStatusCheck({ ...base, today: "2026-09-29" }), true);
});

test("status check never fires for a future month, a paid one, or one with fees", () => {
  assert.equal(needsStatusCheck({ ...base, month: "2026-10", today: "2026-09-29" }), false);
  assert.equal(needsStatusCheck({ ...base, paid: 1000, today: "2026-09-29" }), false);
  assert.equal(needsStatusCheck({ ...base, fees: 70, today: "2026-09-29" }), false);
  assert.equal(needsStatusCheck({ ...base, rent: 0, today: "2026-09-29" }), false);
  // A past month long past its grace period still gets checked.
  assert.equal(needsStatusCheck({ ...base, month: "2026-08", today: "2026-09-29" }), true);
});

test("statuses merge fees for the month or explain why there are none", () => {
  const parsed = parseStatuses({
    statuses: {
      a: { month: "2026-09", fees: 70, cap: 120, line: { tenantName: "A", tone: "charged", text: "Charged $70" } },
      b: { month: "2026-09", fees: 0, cap: 120, line: { tenantName: "B", tone: "none", text: "paid within grace" } },
      bad: { month: 7 },
    },
  });
  assert.deepEqual(Object.keys(parsed).sort(), ["a", "b"]);
  assert.equal(mergedFees(0, parsed.a, "2026-09"), 70);
  assert.equal(mergedFees(0, parsed.a, "2026-08"), 0);
  assert.equal(noFeeLine(parsed.a, "2026-09"), "");
  assert.equal(noFeeLine(parsed.b, "2026-09"), "No late fee: paid within grace");
  assert.equal(noFeeLine(undefined, "2026-09"), "");
  // An explanation about another month isn't shown under this one.
  assert.equal(noFeeLine(parsed.b, "2026-08"), "");
  assert.deepEqual(parseStatuses(null), {});
  assert.deepEqual(parseStatuses({ error: "Not found" }), {});
});
