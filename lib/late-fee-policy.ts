/**
 * The company-wide late-fee policy, in plain data.
 *
 * A policy is the same four numbers a "late" ChargeRule carries — grace
 * days, a one-time percentage, a daily amount, a cap — set once per company
 * instead of once per tenant. It is applied by materialising it as one
 * `fromPolicy` rule on each tenant (lib/statements.ts), so the fees it
 * produces are ordinary charges with run records behind them, the same as a
 * rule typed by hand.
 *
 * Pure: no database, no clock, relative imports only, so it can be tested on
 * its own and shared with the browser.
 */

import { MAX_AUTO_CHARGE, type ChargeRule } from "./charge-rules.ts";

export type LateFeePolicyDTO = {
  enabled: boolean;
  /** Days after the due day before the first fee. */
  graceDays: number;
  /** One-time fee on the first late day, as a percentage of that month's rent. */
  percent: number;
  /** Dollars for each further day the month stays owed. 0 = none. */
  dailyAmount: number;
  /** Ceiling on the month's late fees, as a percentage of that month's rent. 0 = none. */
  capPercent: number;
};

/**
 * What the settings form starts with, and what a company without a saved
 * row is treated as: the numbers the owner asked for, switched off until an
 * owner turns them on. A policy that billed every tenant of every company
 * the day the column arrived would not be a default, it would be a surprise.
 */
export const DEFAULT_POLICY: LateFeePolicyDTO = {
  enabled: false,
  graceDays: 5,
  percent: 7,
  dailyAmount: 5,
  capPercent: 12,
};

/** A grace period longer than a month would never fire before the next one. */
export const MAX_GRACE_DAYS = 28;

export type LateFeeMode = "default" | "custom" | "off";

export const LATE_FEE_MODES: LateFeeMode[] = ["default", "custom", "off"];

export function parseLateFeeMode(value: unknown, fallback: LateFeeMode = "default"): LateFeeMode {
  return value === "custom" || value === "off" || value === "default" ? value : fallback;
}

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Untrusted input (a form, a backup file) into a policy, clamped to what the
 * engine would accept from a rule: nothing negative, no percentage over 100,
 * no daily amount above the automatic-charge ceiling.
 */
export function parsePolicy(input: unknown, base: LateFeePolicyDTO = DEFAULT_POLICY): LateFeePolicyDTO {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    enabled: "enabled" in b ? b.enabled === true : base.enabled,
    graceDays: Math.min(MAX_GRACE_DAYS, Math.max(0, Math.round(num(b.graceDays, base.graceDays)))),
    percent: Math.min(100, Math.max(0, cents(num(b.percent, base.percent)))),
    dailyAmount: Math.min(MAX_AUTO_CHARGE, Math.max(0, cents(num(b.dailyAmount, base.dailyAmount)))),
    capPercent: Math.min(100, Math.max(0, cents(num(b.capPercent, base.capPercent)))),
  };
}

/** A policy with nothing to charge is as good as off. */
export function policyCharges(p: LateFeePolicyDTO): boolean {
  return p.enabled && (p.percent > 0 || p.dailyAmount > 0);
}

/** The label the materialised rule carries, so a charge reads "Late fee". */
export const POLICY_RULE_LABEL = "Late fee";

/**
 * The rule fields a policy stands for on one tenant. `id`, `startMonth` and
 * `active` are the tenant's own business (lib/statements.ts sets them); the
 * rest is the policy verbatim, so comparing these tells whether the rule on
 * file is stale.
 */
export function policyRuleFields(p: LateFeePolicyDTO): Pick<
  ChargeRule,
  "kind" | "label" | "amount" | "percent" | "graceDays" | "dailyAmount" | "capPercent"
> {
  return {
    kind: "late",
    label: POLICY_RULE_LABEL,
    amount: p.percent,
    percent: true,
    graceDays: p.graceDays,
    dailyAmount: p.dailyAmount,
    capPercent: p.capPercent,
  };
}

const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/**
 * The policy in one plain sentence, for the settings page:
 *
 *   "If rent is still owed 5 days after the due day, a late fee of 7% of
 *    that month's rent is charged, then $5 a day until it's paid, up to 12%
 *    of that month's rent ($120 on $1,000)."
 *
 * The worked example on a sample rent is there because "12%" means nothing
 * to a landlord until it's a number.
 */
export function policySentence(p: LateFeePolicyDTO, sampleRent = 1000): string {
  if (!policyCharges(p)) return "No late fees are charged automatically.";
  const when =
    p.graceDays <= 0
      ? "If rent is still owed on the due day"
      : `If rent is still owed ${p.graceDays} ${p.graceDays === 1 ? "day" : "days"} after the due day`;
  const parts: string[] = [];
  if (p.percent > 0) {
    parts.push(`a late fee of ${pct(p.percent)} of that month's rent is charged`);
    if (p.dailyAmount > 0) parts.push(`then ${dollars(p.dailyAmount)} a day until it's paid`);
  } else {
    parts.push(`${dollars(p.dailyAmount)} a day is charged until it's paid`);
  }
  let cap = "";
  if (p.capPercent > 0) {
    const example = sampleRent > 0 ? ` (${dollars(cents((sampleRent * p.capPercent) / 100))} on ${dollars(sampleRent)})` : "";
    cap = `, up to ${pct(p.capPercent)} of that month's rent${example}`;
  }
  return `${when}, ${parts.join(", ")}${cap}.`;
}
