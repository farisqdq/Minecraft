import test from "node:test";
import assert from "node:assert/strict";
import { lateFeesFor, type ChargeRule, type DatedPayment } from "../lib/charge-rules.ts";
import { buildStatement } from "../lib/balance.ts";
import { DEFAULT_POLICY, policyRuleFields } from "../lib/late-fee-policy.ts";
import { lateFeeLine } from "../lib/late-fee-report.ts";
import {
  chargesToRemove,
  isWaived,
  lateRulesAfterWaiver,
  monthOfEntry,
  resumeDay,
  runsToClear,
  waivedKeys,
  waiverLine,
  waiverMonth,
  type WaiverState,
} from "../lib/late-fee-waiver.ts";

/* A commercial LLC's policy: 5 days' grace, 7% once, then $5 a day, at most 12%. */
const POLICY = { ...DEFAULT_POLICY, enabled: true, leaseType: "commercial" as const, capPercent: 12 };
const policyRule = (id: string, over: Partial<ChargeRule> = {}): ChargeRule => ({
  id,
  ...policyRuleFields(POLICY),
  startMonth: null,
  endMonth: null,
  active: true,
  fromPolicy: true,
  accrueFrom: "",
  ...over,
});

const utc = (s: string) => new Date(`${s}T12:00:00.000Z`);
const cents = (n: number) => Math.round(n * 100) / 100;
const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * One tenant's books in memory, and the planner of lib/statements.ts in
 * miniature: every month on the books is walked with buildStatement, late
 * fees come from lateFeesFor with the month's waiver applied exactly as
 * plannedRuleCharges applies it, and a (rule, month, day) that has a run is
 * never charged again. Charges and runs are separate lists, as in the
 * database, so deleting a charge leaves its run.
 */
type Charge = { id: string; month: string; kind: string; ruleId: string | null; amount: number; day: string };
type Run = { id: string; ruleId: string; month: string; day: string; amount: number };
type Books = {
  rent: number;
  dueDay: number;
  startMonth: string;
  rules: ChargeRule[];
  payments: DatedPayment[];
  charges: Charge[];
  runs: Run[];
  waivers: Record<string, WaiverState>;
};

let seq = 0;
const books = (rules: ChargeRule[], over: Partial<Books> = {}): Books => ({
  rent: 1000,
  dueDay: 1,
  startMonth: "2026-08",
  rules,
  payments: [],
  charges: [],
  runs: [],
  waivers: {},
  ...over,
});

/** One statement load / cron run on `today`. */
function run(b: Books, today: string) {
  const known = b.payments.filter((p) => p.day <= today);
  const done = new Set(b.runs.map((r) => `${r.ruleId}|${r.month}|${r.day}`));
  buildStatement({
    startMonth: b.startMonth,
    currentMonth: today.slice(0, 7),
    rentFor: () => b.rent,
    charges: b.charges.map((c) => ({ month: c.month, kind: "fee" as const, amount: c.amount, label: "x" })),
    payments: known.map((p) => ({ month: p.day.slice(0, 7), amount: p.amount })),
    assess: (month, owed, rent) => {
      const fees = lateFeesFor({
        rules: lateRulesAfterWaiver(b.rules, b.waivers[month]),
        month,
        owed,
        rentThisMonth: rent,
        dueDay: b.dueDay,
        today: utc(today),
        payments: known,
        applied: b.runs.filter((r) => r.month === month),
      }).filter((f) => !done.has(`${f.ruleId}|${month}|${f.day ?? ""}`));
      for (const f of fees) {
        const id = `c${++seq}`;
        b.runs.push({ id: `r${seq}`, ruleId: f.ruleId, month, day: f.day ?? "", amount: f.amount });
        b.charges.push({ id, month, kind: "fee", ruleId: f.ruleId, amount: f.amount, day: f.day ?? today });
      }
      return fees.map((f) => ({ month, kind: "fee" as const, amount: f.amount, label: f.label }));
    },
  });
}

/** The daily job, every day from `from` to `to`, inclusive. */
function runDaily(b: Books, from: string, to: string) {
  for (let d = from; d <= to; d = nextDay(d)) run(b, d);
}

const lateIds = (b: Books) => new Set(b.rules.filter((r) => r.kind === "late").map((r) => r.id));

/** What lib/late-fee-waivers-db.ts does on waive: the row, then the deletes. */
function waive(b: Books, month: string, today: string) {
  b.waivers[month] = { month, waivedAt: utc(today), waivedByName: "Dana" };
  const gone = new Set(chargesToRemove(b.charges, lateIds(b), month));
  b.charges = b.charges.filter((c) => !gone.has(c.id));
}

/** …and on un-waive: stamp the day, clear the month's late runs. */
function unwaive(b: Books, month: string, today: string) {
  b.waivers[month] = { ...b.waivers[month], unwaivedAt: utc(today) };
  const clear = new Set(runsToClear(b.runs, lateIds(b), month).map((r) => r.id));
  b.runs = b.runs.filter((r) => !clear.has(r.id));
}

const feesFor = (b: Books, month: string) =>
  cents(b.charges.filter((c) => c.month === month && c.ruleId).reduce((s, c) => s + c.amount, 0));

/* ---- waiving ---- */

test("waiving September removes its fees, keeps their runs, and later runs never re-add them", () => {
  const a = books([policyRule("pA")]);
  runDaily(a, "2026-08-01", "2026-09-20");
  assert.equal(feesFor(a, "2026-09"), 120, "Sept had reached the 12% cap before the waiver");
  const runsBefore = a.runs.filter((r) => r.month === "2026-09").length;

  waive(a, "2026-09", "2026-09-20");
  assert.equal(feesFor(a, "2026-09"), 0, "every September late fee is gone");
  assert.equal(a.runs.filter((r) => r.month === "2026-09").length, runsBefore, "runs are kept");

  // The daily job, "Run late fees now" and statement loads, twice a day for weeks.
  runDaily(a, "2026-09-20", "2026-10-31");
  runDaily(a, "2026-09-20", "2026-10-31");
  assert.equal(feesFor(a, "2026-09"), 0);
  assert.equal(a.charges.filter((c) => c.month === "2026-09").length, 0);
});

test("a waiver ticked before the grace period ends means September never gets a fee at all", () => {
  const a = books([policyRule("pA")], { startMonth: "2026-09" });
  run(a, "2026-09-02");
  waive(a, "2026-09", "2026-09-02");
  runDaily(a, "2026-09-02", "2026-09-30");
  assert.equal(feesFor(a, "2026-09"), 0);
});

test("the tenant's unpaid August keeps (and still gets) its fee when September is waived", () => {
  // Policy switched on Sep 20: August's one-time fee is due that day.
  const a = books([policyRule("pA", { accrueFrom: "2026-09-20" })]);
  waive(a, "2026-09", "2026-09-19");
  runDaily(a, "2026-09-19", "2026-09-30");
  assert.equal(feesFor(a, "2026-09"), 0);
  assert.equal(feesFor(a, "2026-08"), 120, "August: $70 on the 20th, then $5/day to the cap");
});

test("October rent past grace gets the 7% and the daily fees as normal, up to the same cap", () => {
  const a = books([policyRule("pA")], { startMonth: "2026-09" });
  runDaily(a, "2026-09-01", "2026-09-10");
  waive(a, "2026-09", "2026-09-10");
  runDaily(a, "2026-09-10", "2026-10-31");
  const oct = a.charges.filter((c) => c.month === "2026-10");
  assert.equal(oct[0].amount, 70, "the one-time 7%");
  assert.equal(oct[0].day, "2026-10-06");
  assert.deepEqual(
    oct.slice(1).map((c) => [c.day, c.amount]),
    ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16"].map((d) => [`2026-10-${d}`, 5])
  );
  assert.equal(feesFor(a, "2026-10"), 120, "12% cap for October, unaffected");
  assert.equal(feesFor(a, "2026-09"), 0);
});

test("another tenant in the same LLC, same month, still gets their fee", () => {
  const a = books([policyRule("pA")], { startMonth: "2026-09" });
  const b = books([policyRule("pB")], { startMonth: "2026-09" });
  waive(a, "2026-09", "2026-09-03");
  runDaily(a, "2026-09-01", "2026-09-30");
  runDaily(b, "2026-09-01", "2026-09-30");
  assert.equal(feesFor(a, "2026-09"), 0);
  assert.equal(feesFor(b, "2026-09"), 120);
});

test("monthly rules (a lot fee) are not late fees and carry on in a waived month", () => {
  const lot: ChargeRule = {
    id: "lot",
    kind: "monthly",
    label: "Lot fee",
    amount: 50,
    percent: false,
    graceDays: 0,
    startMonth: null,
    endMonth: null,
    active: true,
  };
  const rules = lateRulesAfterWaiver([policyRule("pA"), lot], { month: "2026-09", waivedAt: utc("2026-09-01") });
  assert.deepEqual(rules.map((r) => r.id), ["lot"]);
  // Charges: only the late rule's go; a typed-in fee and the lot fee stay.
  const charges = [
    { id: "1", month: "2026-09", kind: "fee", ruleId: "pA" },
    { id: "2", month: "2026-09", kind: "fee", ruleId: "lot" },
    { id: "3", month: "2026-09", kind: "fee", ruleId: null },
    { id: "4", month: "2026-08", kind: "fee", ruleId: "pA" },
  ];
  assert.deepEqual(chargesToRemove(charges, new Set(["pA"]), "2026-09"), ["1"]);
});

test("the rules passed in are never changed — the policy and the other months stay as they were", () => {
  const rules = [policyRule("pA", { accrueFrom: "2026-09-01" })];
  const snapshot = JSON.stringify(rules);
  lateRulesAfterWaiver(rules, { month: "2026-09", waivedAt: utc("2026-09-10") });
  lateRulesAfterWaiver(rules, { month: "2026-09", waivedAt: utc("2026-09-10"), unwaivedAt: utc("2026-09-20") });
  assert.equal(JSON.stringify(rules), snapshot);
  assert.equal(lateRulesAfterWaiver(rules, undefined), rules, "no waiver: the very same rules");
});

/* ---- un-waiving ---- */

test("un-waiving resumes from that day: the one-time fee comes back if still owed, daily fees from the next day, no backfill", () => {
  const a = books([policyRule("pA")], { startMonth: "2026-09" });
  runDaily(a, "2026-09-01", "2026-09-10");
  assert.equal(feesFor(a, "2026-09"), 90, "$70 + four days by the 10th");
  waive(a, "2026-09", "2026-09-10");
  runDaily(a, "2026-09-10", "2026-09-19");
  assert.equal(feesFor(a, "2026-09"), 0);

  unwaive(a, "2026-09", "2026-09-20");
  run(a, "2026-09-20");
  const sep = () => a.charges.filter((c) => c.month === "2026-09");
  assert.deepEqual(sep().map((c) => [c.day, c.amount]), [["2026-09-20", 70]], "one-time fee, on the un-waive day");

  runDaily(a, "2026-09-20", "2026-09-30");
  assert.ok(sep().every((c) => c.day >= "2026-09-20"), "nothing billed for the waived days");
  assert.deepEqual(
    sep().slice(1).map((c) => c.day),
    ["21", "22", "23", "24", "25", "26", "27", "28", "29", "30"].map((d) => `2026-09-${d}`)
  );
  assert.equal(feesFor(a, "2026-09"), 120, "and the month still stops at the cap");
});

test("un-waiving after the month was paid brings nothing back", () => {
  const a = books([policyRule("pA")], { startMonth: "2026-09" });
  runDaily(a, "2026-09-01", "2026-09-10");
  waive(a, "2026-09", "2026-09-10");
  a.payments.push({ day: "2026-09-12", amount: 1000 });
  unwaive(a, "2026-09", "2026-09-20");
  runDaily(a, "2026-09-20", "2026-09-30");
  assert.equal(feesFor(a, "2026-09"), 0);
});

test("un-waived with part still owed: the one-time fee is capped at what's owed that day", () => {
  const a = books([policyRule("pA")], { startMonth: "2026-09" });
  waive(a, "2026-09", "2026-09-01");
  a.payments.push({ day: "2026-09-12", amount: 960 });
  unwaive(a, "2026-09", "2026-09-20");
  run(a, "2026-09-20");
  assert.equal(feesFor(a, "2026-09"), 40, "only $40 was owed on the 20th");
});

test("waiving again after an un-waive removes what accrued since, and stops it again", () => {
  const a = books([policyRule("pA")], { startMonth: "2026-09" });
  waive(a, "2026-09", "2026-09-01");
  unwaive(a, "2026-09", "2026-09-20");
  runDaily(a, "2026-09-20", "2026-09-24");
  assert.equal(feesFor(a, "2026-09"), 90);
  waive(a, "2026-09", "2026-09-24");
  runDaily(a, "2026-09-24", "2026-09-30");
  assert.equal(feesFor(a, "2026-09"), 0);
});

test("un-waiving clears only that month's late runs", () => {
  const runs = [
    { ruleId: "pA", month: "2026-09", day: "" },
    { ruleId: "pA", month: "2026-09", day: "2026-09-07" },
    { ruleId: "pA", month: "2026-08", day: "" },
    { ruleId: "lot", month: "2026-09", day: "" },
  ];
  assert.deepEqual(runsToClear(runs, new Set(["pA"]), "2026-09"), runs.slice(0, 2));
});

test("an un-waived month never starts a rule earlier than it already did", () => {
  const w = { month: "2026-09", waivedAt: utc("2026-09-02"), unwaivedAt: utc("2026-09-05") };
  assert.equal(resumeDay(w), "2026-09-05");
  const [late] = lateRulesAfterWaiver([policyRule("pA", { accrueFrom: "2026-09-10" })], w);
  assert.equal(late.accrueFrom, "2026-09-10");
  const [late2] = lateRulesAfterWaiver([policyRule("pA", { accrueFrom: "2026-09-01" })], w);
  assert.equal(late2.accrueFrom, "2026-09-05");
});

test("'Run late fees now' says the month was waived rather than inventing a reason", () => {
  const l = lateFeeLine({
    tenantName: "Alan",
    mode: "default",
    policyOn: true,
    ownLateRule: false,
    added: 0,
    feesThisMonth: 0,
    month: "2026-09",
    balance: 500,
    rentThisMonth: 1000,
    dueDay: 1,
    graceDays: 5,
    today: "2026-09-29",
    problem: "",
    capped: false,
    waived: true,
  });
  assert.equal(l.tone, "none");
  assert.equal(l.text, "Late fee waived for September 2026 — none is charged for it.");
});

/* ---- small parts ---- */

test("months, keys and the line on the statement", () => {
  assert.equal(waiverMonth("2026-09"), "2026-09");
  assert.equal(waiverMonth("2026-13"), "");
  assert.equal(waiverMonth(7), "");
  assert.equal(monthOfEntry("2026-09-29"), "2026-09");
  assert.equal(isWaived({ month: "2026-09", waivedAt: "2026-09-29T00:00:00Z" }), true);
  assert.equal(isWaived({ month: "2026-09", waivedAt: "2026-09-29T00:00:00Z", unwaivedAt: "2026-09-30T00:00:00Z" }), false);
  assert.equal(isWaived(null), false);
  assert.deepEqual(
    waivedKeys([
      { tenantId: "a", month: "2026-09", waivedAt: "2026-09-29T00:00:00Z" },
      { tenantId: "b", month: "2026-09", waivedAt: "2026-09-29T00:00:00Z", unwaivedAt: "2026-09-30T00:00:00Z" },
    ]),
    { "a|2026-09": true }
  );
  assert.equal(
    waiverLine({ month: "2026-09", waivedAt: "2026-09-29T15:00:00Z", waivedByName: "Dana" }),
    "Late fee waived by Dana on Sep 29"
  );
});
