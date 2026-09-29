/*
 * Lease types (a22): each LLC's late-fee policy says whether its leases are
 * residential (cap 10% by default) or commercial (cap 12%), and every tenant
 * of the LLC follows it. Per-tenant overrides and waivers are untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { lateFeesFor, type AppliedFee, type ChargeRule } from "../lib/charge-rules.ts";
import {
  DEFAULT_CAP_PERCENT,
  DEFAULT_POLICY,
  migratedPolicy,
  parseLeaseType,
  parsePolicy,
  policyRuleFields,
  policyRuleMatches,
  policySentence,
  type LateFeePolicyDTO,
} from "../lib/late-fee-policy.ts";
import { cardLateFeeLine, capFor } from "../lib/late-fee-card.ts";
import { lateFeeLine, type LateFeeFacts } from "../lib/late-fee-report.ts";
import { lateFeeSummary } from "../lib/late-fee-text.ts";
import { lateRulesAfterWaiver } from "../lib/late-fee-waiver.ts";

const RESIDENTIAL: LateFeePolicyDTO = { ...DEFAULT_POLICY, enabled: true };
const COMMERCIAL: LateFeePolicyDTO = { ...RESIDENTIAL, leaseType: "commercial", capPercent: DEFAULT_CAP_PERCENT.commercial };

const rule = (p: LateFeePolicyDTO, over: Partial<ChargeRule> = {}): ChargeRule => ({
  id: "p",
  ...policyRuleFields(p),
  startMonth: null,
  endMonth: null,
  active: true,
  fromPolicy: true,
  accrueFrom: "",
  ...over,
});

const utc = (s: string) => new Date(`${s}T12:00:00.000Z`);
const cents = (n: number) => Math.round(n * 100) / 100;
const total = (fees: { amount: number }[]) => cents(fees.reduce((s, f) => s + f.amount, 0));

/** A September left unpaid, looked at on the 29th. */
const september = (p: LateFeePolicyDTO, rent: number, applied: AppliedFee[] = []) =>
  lateFeesFor({
    rules: [rule(p)],
    month: "2026-09",
    owed: cents(rent + total(applied)),
    rentThisMonth: rent,
    dueDay: 1,
    today: utc("2026-09-29"),
    applied,
  });

/** The runs a September at the old 12% cap left behind: $70 then ten $5 days. */
const oldCapRuns: AppliedFee[] = [
  { ruleId: "p", day: "", amount: 70 },
  ...["07", "08", "09", "10", "11", "12", "13", "14", "15", "16"].map((d) => ({
    ruleId: "p",
    day: `2026-09-${d}`,
    amount: 5,
  })),
];

/* ---- defaults ---- */

test("a new LLC is residential: 7% after 5 days' grace, $5/day, cap 10%", () => {
  assert.deepEqual(DEFAULT_POLICY, {
    enabled: false,
    leaseType: "residential",
    graceDays: 5,
    percent: 7,
    dailyAmount: 5,
    capPercent: 10,
  });
  assert.deepEqual(DEFAULT_CAP_PERCENT, { residential: 10, commercial: 12 });
});

/* ---- the cap per lease type ---- */

test("residential, $1,000 rent: $70 + 6 × $5 = $100, the 10% cap", () => {
  const fees = september(RESIDENTIAL, 1000);
  assert.equal(fees[0].amount, 70);
  assert.equal(fees.filter((f) => f.day).length, 6);
  assert.equal(total(fees), 100);
});

test("commercial, $1,000 rent: $70 + 10 × $5 = $120, the 12% cap", () => {
  const fees = september(COMMERCIAL, 1000);
  assert.equal(fees[0].amount, 70);
  assert.equal(fees.filter((f) => f.day).length, 10);
  assert.equal(total(fees), 120);
});

test("the Furniture Store, $4,570: $319.90 once; cap $548.40 commercial, $457 residential", () => {
  assert.equal(september(COMMERCIAL, 4570)[0].amount, 319.9);
  assert.equal(capFor(COMMERCIAL, 4570), 548.4);
  assert.equal(capFor(RESIDENTIAL, 4570), 457);
  // By the 29th it's $319.90 + 23 × $5 = $434.90 — under either cap — and
  // the caps only differ once the daily fees reach them.
  assert.equal(total(september(COMMERCIAL, 4570)), 434.9);
  assert.equal(total(september(RESIDENTIAL, 4570)), 434.9);
  const october = (p: LateFeePolicyDTO) =>
    total(
      lateFeesFor({ rules: [rule(p)], month: "2026-10", owed: 4570, rentThisMonth: 4570, dueDay: 1, today: utc("2026-11-30") })
    );
  assert.equal(october(COMMERCIAL), 548.4);
  assert.equal(october(RESIDENTIAL), 457);
});

test("Alan's card: commercial and residential", () => {
  const card = (policy: LateFeePolicyDTO) => cardLateFeeLine({ fees: 319.9, rent: 4570, policy, mode: "default" });
  assert.equal(card(COMMERCIAL), "Late fees $319.90 (7% + $5/day, cap $548.40) · 58% of cap");
  assert.equal(card(RESIDENTIAL), "Late fees $319.90 (7% + $5/day, cap $457) · 70% of cap");
});

test("a card whose fees sit above a lowered cap says so, not 'cap reached'", () => {
  assert.equal(
    cardLateFeeLine({ fees: 120, rent: 1000, policy: RESIDENTIAL, mode: "default" }),
    "Late fees $120 (7% + $5/day, cap $100) · above cap"
  );
  assert.equal(
    cardLateFeeLine({ fees: 100, rent: 1000, policy: RESIDENTIAL, mode: "default" }),
    "Late fees $100 (7% + $5/day, cap $100) · cap reached"
  );
});

test("the rent-late reminder names the LLC's cap", () => {
  assert.equal(
    lateFeeSummary({ rent: 1000, policy: RESIDENTIAL, feesSoFar: 70 }),
    "a $70 late fee was added; $5/day more until paid, up to $100"
  );
  assert.equal(
    lateFeeSummary({ rent: 1000, policy: COMMERCIAL, feesSoFar: 70 }),
    "a $70 late fee was added; $5/day more until paid, up to $120"
  );
});

test("the settings sentence says which lease type it is", () => {
  assert.equal(
    policySentence(RESIDENTIAL, 1000, true),
    "Residential: If rent is still owed 5 days after the due day, a late fee of 7% of that month's rent is charged, then $5 a day until it's paid, up to 10% of that month's rent ($100 on $1,000)."
  );
  assert.match(policySentence(COMMERCIAL, 1000, true), /^Commercial: .* up to 12% of that month's rent \(\$120 on \$1,000\)\.$/);
  assert.equal(policySentence({ ...COMMERCIAL, enabled: false }, 1000, true), "Commercial: No late fees are charged automatically.");
  assert.doesNotMatch(policySentence(RESIDENTIAL), /Residential/, "left off unless asked for");
});

/* ---- lowering a cap ---- */

test("lowering the cap never adds a fee to a month already above it", () => {
  // $120 charged under the old 12%; the LLC is now residential at 10% ($100).
  assert.deepEqual(september(RESIDENTIAL, 1000, oldCapRuns), []);
  // Not tomorrow either, nor at the month's end.
  const later = lateFeesFor({
    rules: [rule(RESIDENTIAL)],
    month: "2026-09",
    owed: 1120,
    rentThisMonth: 1000,
    dueDay: 1,
    today: utc("2026-10-15"),
    applied: oldCapRuns,
  });
  assert.deepEqual(later, []);
});

test("lowering the cap to just above what's charged adds only the room left", () => {
  const runs = oldCapRuns.slice(0, 6); // $70 + 5 × $5 = $95
  const fees = september(RESIDENTIAL, 1000, runs);
  assert.equal(total(fees), 5, "one more $5 day, to $100");
});

test("lowering the cap never deletes: the engine only ever proposes additions", () => {
  // lateFeesFor returns fees to add, never removals; with the cap lowered it
  // returns nothing, so the $120 already on the books stays exactly as it is.
  for (const cap of [0.5, 5, 10, 11.99]) {
    const fees = september({ ...RESIDENTIAL, capPercent: cap }, 1000, oldCapRuns);
    assert.ok(fees.every((f) => f.amount > 0), `cap ${cap}: nothing negative`);
    assert.equal(fees.length, 0, `cap ${cap}: nothing added`);
  }
});

/* ---- "Run late fees now" lists a month above the new cap ---- */

const facts: LateFeeFacts = {
  tenantName: "Alan D Ward",
  mode: "default",
  policyOn: true,
  ownLateRule: false,
  added: 0,
  feesThisMonth: 150,
  month: "2026-09",
  balance: 1150,
  rentThisMonth: 1000,
  dueDay: 1,
  graceDays: 5,
  today: "2026-09-29",
  problem: "",
  capped: true,
  aboveCap: { cap: 100, capPercent: 10 },
};

test("fees above a lowered cap are listed, with what to do about them", () => {
  const l = lateFeeLine(facts);
  assert.equal(l.tone, "check");
  assert.equal(l.tenantName, "Alan D Ward");
  assert.equal(
    l.text,
    "$150 in late fees for September 2026 is above the new 10% cap ($100). No more will be added; delete the extra on their statement if you want it gone."
  );
  assert.equal(
    lateFeeLine({ ...facts, feesThisMonth: 120 }).text,
    "$120 in late fees for September 2026 is above the new 10% cap ($100). No more will be added; delete the extra on their statement if you want it gone."
  );
});

test("at the cap, not above it, the line is the usual one", () => {
  assert.match(lateFeeLine({ ...facts, feesThisMonth: 100 }).text, /already — the most the month can carry/);
  assert.match(lateFeeLine({ ...facts, aboveCap: undefined, feesThisMonth: 100 }).text, /the most the month can carry/);
});

test("overrides come first: a tenant set to off, waived, or on own rules isn't told about the LLC's cap", () => {
  assert.match(lateFeeLine({ ...facts, mode: "off" }).text, /no late fees on their account/);
  assert.match(lateFeeLine({ ...facts, waived: true }).text, /Late fee waived for September 2026/);
  assert.doesNotMatch(lateFeeLine({ ...facts, mode: "custom", ownLateRule: true }).text, /new 10% cap/);
});

/* ---- switching the LLC's lease type updates each tenant's rule ---- */

test("a lease-type or cap change makes the tenant's policy rule stale; the same numbers don't", () => {
  const onFile = rule(COMMERCIAL);
  assert.equal(policyRuleMatches(onFile, COMMERCIAL), true);
  assert.equal(policyRuleMatches(onFile, RESIDENTIAL), false, "commercial → residential brings cap 10");
  assert.equal(policyRuleMatches(onFile, { ...COMMERCIAL, leaseType: "residential" }), true, "type alone, same numbers: nothing to rewrite");
  assert.equal(policyRuleMatches(onFile, { ...COMMERCIAL, graceDays: 3 }), false);
  assert.equal(policyRuleMatches(onFile, { ...COMMERCIAL, enabled: false }), true, "on/off is handled by the rule's active flag");
  // The rewrite carries the new cap; the rule's id, start and runs are the tenant's own.
  assert.equal(policyRuleFields(RESIDENTIAL).capPercent, 10);
  assert.equal(policyRuleFields(COMMERCIAL).capPercent, 12);
});

/* ---- waivers and own rules are untouched ---- */

test("a waived month still gets no late fee under either lease type", () => {
  const waived = { month: "2026-09", waivedAt: "2026-09-20T00:00:00.000Z", unwaivedAt: null };
  for (const p of [RESIDENTIAL, COMMERCIAL]) {
    const fees = lateFeesFor({
      rules: lateRulesAfterWaiver([rule(p)], waived),
      month: "2026-09",
      owed: 1000,
      rentThisMonth: 1000,
      dueDay: 1,
      today: utc("2026-09-29"),
    });
    assert.deepEqual(fees, []);
  }
});

test("a tenant's own rule keeps its own cap whatever the LLC's lease type", () => {
  const own = rule(COMMERCIAL, { id: "own", fromPolicy: false, capPercent: 15, label: "Late fee (lease)" });
  const fees = lateFeesFor({
    rules: [own],
    month: "2026-09",
    owed: 1000,
    rentThisMonth: 1000,
    dueDay: 1,
    today: utc("2026-09-29"),
  });
  assert.equal(total(fees), 70 + 16 * 5, "15% would be $150; Sept 7–29 is 23 days, so $70 + 16 × $5 reaches it");
});

/* ---- migration ---- */

test("migration: the untouched old defaults become residential at 10%, on or off", () => {
  for (const enabled of [true, false]) {
    assert.deepEqual(migratedPolicy({ enabled, graceDays: 5, percent: 7, dailyAmount: 5, capPercent: 12 }), {
      enabled,
      leaseType: "residential",
      graceDays: 5,
      percent: 7,
      dailyAmount: 5,
      capPercent: 10,
    });
  }
});

test("migration: any saved numbers a landlord chose are kept exactly, as residential", () => {
  const kept = [
    { enabled: true, graceDays: 3, percent: 7, dailyAmount: 5, capPercent: 12 },
    { enabled: true, graceDays: 5, percent: 7, dailyAmount: 5, capPercent: 15 },
    { enabled: true, graceDays: 5, percent: 8, dailyAmount: 5, capPercent: 12 },
    { enabled: false, graceDays: 5, percent: 7, dailyAmount: 10, capPercent: 12 },
    { enabled: true, graceDays: 5, percent: 7, dailyAmount: 5, capPercent: 0 },
  ];
  for (const saved of kept) assert.deepEqual(migratedPolicy(saved), { ...saved, leaseType: "residential" });
});

/* ---- backups ---- */

test("backup round trip keeps the LLC's lease type and numbers", () => {
  const exported = JSON.parse(JSON.stringify({ lateFees: COMMERCIAL }));
  assert.deepEqual(parsePolicy(exported.lateFees), COMMERCIAL);
  const custom = { ...RESIDENTIAL, capPercent: 9.5, graceDays: 3 };
  assert.deepEqual(parsePolicy(JSON.parse(JSON.stringify(custom))), custom);
});

test("an older backup without a lease type restores as residential, numbers as saved", () => {
  const old = { enabled: true, graceDays: 5, percent: 7, dailyAmount: 5, capPercent: 12 };
  assert.deepEqual(parsePolicy(old), { ...old, leaseType: "residential" });
});

test("a lease type is one of two; anything else reads as residential", () => {
  assert.equal(parseLeaseType("commercial"), "commercial");
  assert.equal(parseLeaseType("Commercial"), "residential");
  assert.equal(parseLeaseType(undefined), "residential");
  assert.equal(parsePolicy({ leaseType: "industrial" }).leaseType, "residential");
  assert.equal(parsePolicy({ percent: 9 }, COMMERCIAL).leaseType, "commercial", "left out keeps the base");
});
