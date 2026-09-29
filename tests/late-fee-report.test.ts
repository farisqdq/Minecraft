import test from "node:test";
import assert from "node:assert/strict";
import { lateFeeLine, type LateFeeFacts } from "../lib/late-fee-report.ts";

const base: LateFeeFacts = {
  tenantName: "Maria",
  mode: "default",
  policyOn: true,
  ownLateRule: false,
  added: 0,
  feesThisMonth: 0,
  month: "2026-09",
  balance: 1000,
  rentThisMonth: 1000,
  dueDay: 1,
  graceDays: 5,
  today: "2026-09-28",
  problem: "",
  capped: false,
};

const unitA = { label: "#A", wholeProperty: false, vacant: false, vacantSince: null, rentSet: 4570 };
const whole = { label: "the whole property", wholeProperty: true, vacant: false, vacantSince: null, rentSet: 0 };

test("a run that charged says how much, and the month's total", () => {
  const l = lateFeeLine({ ...base, added: 70, feesThisMonth: 70 });
  assert.equal(l.tone, "charged");
  assert.equal(l.text, "$70 in late fees added now ($70 for September 2026 so far).");
});

test("a run that charged several months names each one", () => {
  const l = lateFeeLine({ ...base, added: 168, month: "2026-08", feesThisMonth: 84, addedByMonth: { "2026-09": 84, "2026-08": 84 } });
  assert.equal(l.text, "$168 in late fees added now ($84 for August 2026, $84 for September 2026).");
});

test("each reason for no fee is named", () => {
  assert.match(lateFeeLine({ ...base, mode: "off" }).text, /no late fees on their account/);
  assert.equal(lateFeeLine({ ...base, mode: "custom" }).tone, "check", "own rules, none active");
  assert.match(lateFeeLine({ ...base, policyOn: false }).text, /switched off/);
  assert.match(lateFeeLine({ ...base, balance: 0 }).text, /Paid up/);
  assert.match(lateFeeLine({ ...base, rentThisMonth: 0 }).text, /No rent is expected for September 2026/);
  assert.match(lateFeeLine({ ...base, today: "2026-09-04" }).text, /grace period \(rent due on the 1st, 5 days' grace\) — the fee applies on Sep 6/);
  assert.match(lateFeeLine({ ...base, feesThisMonth: 120, capped: true }).text, /\$120 in late fees for September 2026 already — the most/);
  assert.match(lateFeeLine({ ...base, problem: "Two tenants share this property" }).text, /Two tenants share/);
  assert.match(lateFeeLine({ ...base, feesThisMonth: 70 }).text, /\$70 in late fees for September 2026 so far; nothing more is due today/);
});

/* ---- $0 rent: vacant, unassigned, or no rent set are three different fixes ---- */

test("on the whole property while the rent is on a unit: assign them to it", () => {
  const l = lateFeeLine({ ...base, rentThisMonth: 0, balance: 0, place: whole, unitsWithRent: ["#A", "#B"] });
  assert.equal(l.tone, "check");
  assert.equal(
    l.text,
    "Their statement expects $0 rent for September 2026: they're on the whole property, but the rent is set on unit #A and unit #B. Assign them to their unit on their card."
  );
  assert.equal(
    lateFeeLine({ ...base, rentThisMonth: 0, place: whole, unitsWithRent: ["#A"] }).text,
    "Their statement expects $0 rent for September 2026: they're on the whole property, but the rent is set on unit #A. Assign them to #A on their card."
  );
  // A unit already called "Unit 2" isn't "unit Unit 2".
  assert.match(lateFeeLine({ ...base, rentThisMonth: 0, place: whole, unitsWithRent: ["Unit 2"] }).text, /set on Unit 2\. Assign them to Unit 2/);
});

test("marked vacant says where, since when, and what to clear", () => {
  const l = lateFeeLine({ ...base, rentThisMonth: 0, balance: 0, place: { ...unitA, vacant: true, vacantSince: "2026-09-01" } });
  assert.equal(l.tone, "none");
  assert.equal(
    l.text,
    "No rent is expected for September 2026: unit #A is marked vacant (since Sep 1), so no late fee. If they still rent it, clear Vacant on the card."
  );
});

test("no rent set is not 'vacant'", () => {
  const l = lateFeeLine({ ...base, rentThisMonth: 0, balance: 0, place: { ...unitA, rentSet: 0 } });
  assert.equal(l.text, "No rent is set for unit #A, so there's no rent to be late with. Set the monthly rent on the card.");
  assert.doesNotMatch(l.text, /vacant/);
  assert.match(lateFeeLine({ ...base, rentThisMonth: 0, place: unitA }).text, /rent history for unit #A says \$0/);
});

/* ---- the rest of the paths, each with its own fix ---- */

test("moved out: books closed", () => {
  assert.match(lateFeeLine({ ...base, active: false }).text, /^Marked moved out, so their books are closed/);
});

test("the policy on a different LLC names both", () => {
  const l = lateFeeLine({ ...base, policyOn: false, companyName: "Store LLC", policyOnFor: ["Homes LLC"] });
  assert.equal(l.tone, "check");
  assert.equal(
    l.text,
    "Late fees are switched off for Store LLC, the LLC this property is under. The policy is on for Homes LLC, not this one — turn it on for Store LLC on the Team page."
  );
  assert.equal(lateFeeLine({ ...base, policyOn: false, companyName: "Store LLC" }).tone, "none");
});

test("own rules that don't cover the month say which and why", () => {
  const l = lateFeeLine({ ...base, mode: "custom", ownLateRule: true, ownRules: [{ label: "Late fee", startMonth: "2026-01", endMonth: "2026-06" }] });
  assert.equal(l.tone, "check");
  assert.match(l.text, /none covers September 2026 \("Late fee" ended June 2026\)/);
  assert.match(
    lateFeeLine({ ...base, mode: "custom", ownLateRule: true, ownRules: [{ label: "Late fee", startMonth: "2026-10", endMonth: null }] }).text,
    /starts October 2026/
  );
  // One that covers it falls through to the usual lines, and says whose rules.
  assert.match(
    lateFeeLine({ ...base, mode: "custom", ownLateRule: true, feesThisMonth: 50, ownRules: [{ label: "Late fee", startMonth: null, endMonth: null }] }).text,
    /\$50 in late fees for September 2026 so far; nothing more is due today — under their own late-fee rules, not the LLC's policy\./
  );
});

test("a statement that starts after the month can't be late for it", () => {
  const l = lateFeeLine({ ...base, balance: 0, rentThisMonth: 0, startMonth: "2026-10", startPinned: true });
  assert.equal(
    l.text,
    "Their statement starts in October 2026 (set on their statement), so September 2026's rent isn't on it and can't be late. Change where their books start on their statement."
  );
});

test("two tenants on one place: no fee, and who they are", () => {
  const l = lateFeeLine({ ...base, sharedWith: ["Bob"], place: unitA, problem: "shared" });
  assert.equal(l.tone, "check");
  assert.match(l.text, /^No late fee while Maria and Bob are both on unit #A/);
});

test("covered by earlier money is not the same as nothing due", () => {
  assert.equal(
    lateFeeLine({ ...base, balance: 0, paidThisMonth: 0 }).text,
    "Nothing owed: September 2026's $1,000 is covered by earlier payments or a credit on their statement, though no rent is dated in September 2026."
  );
  assert.equal(lateFeeLine({ ...base, balance: 0, paidThisMonth: 1000 }).text, "Paid up — nothing owed.");
});

test("a deleted fee is named, not blamed on an opening balance", () => {
  const l = lateFeeLine({ ...base, deletedThisMonth: 319.9 });
  assert.equal(l.tone, "check");
  assert.match(l.text, /^\$319\.90 in late fees for September 2026 was charged and then deleted/);
  assert.match(lateFeeLine(base).text, /opening balance/);
});

test("the Furniture Store: $867.22 of $4,570 paid, fee charged", () => {
  const l = lateFeeLine({ ...base, tenantName: "Alan D Ward", rentThisMonth: 4570, balance: 4022.68, added: 319.9, feesThisMonth: 319.9, paidThisMonth: 867.22, place: unitA });
  assert.equal(l.tone, "charged");
  assert.equal(l.text, "$319.90 in late fees added now ($319.90 for September 2026 so far).");
});
