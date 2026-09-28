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
  assert.match(lateFeeLine({ ...base, rentThisMonth: 0 }).text, /vacant/);
  assert.match(lateFeeLine({ ...base, today: "2026-09-04" }).text, /grace period — the fee applies on Sep 6/);
  assert.match(lateFeeLine({ ...base, feesThisMonth: 120, capped: true }).text, /\$120 in late fees for September 2026 already — the most/);
  assert.match(lateFeeLine({ ...base, problem: "Two tenants share this property" }).text, /Two tenants share/);
  assert.match(lateFeeLine({ ...base, feesThisMonth: 70 }).text, /\$70 in late fees for September 2026 so far; nothing more is due today/);
});
