/**
 * The late-fee line for a rent-late reminder.
 *
 * Pure text: no database, no clock. The reminder run (lib/reminders-db.ts)
 * already works out the tenant's statement before it writes to them, so it
 * knows what late fees have landed this month; this turns that into one
 * sentence a tenant can act on.
 */

import { policyCharges, type LateFeePolicyDTO } from "./late-fee-policy.ts";

const cents = (n: number) => Math.round(n * 100) / 100;
const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * "a $70 late fee was added; $5/day more until paid, up to $120" — or an
 * empty string when the policy charges nothing, so the reminder can drop the
 * clause rather than print "a $0 late fee".
 *
 * `feesSoFar` is what the month's late fees add up to on the books already.
 * Before any has landed (the reminder ran ahead of the fee, or the month's
 * fee was capped by a small balance) the one-time fee is described from the
 * policy instead, as what applies rather than what was added.
 */
export function lateFeeSummary(opts: {
  rent: number;
  policy: Pick<LateFeePolicyDTO, "enabled" | "graceDays" | "percent" | "dailyAmount" | "capPercent">;
  feesSoFar?: number;
}): string {
  const { rent, policy } = opts;
  const feesSoFar = cents(Math.max(0, opts.feesSoFar || 0));
  if (!policyCharges({ ...policy, enabled: policy.enabled })) return "";
  if (!(rent > 0)) return "";

  const cap = policy.capPercent > 0 ? cents((rent * policy.capPercent) / 100) : 0;
  const oneTime = cents((rent * policy.percent) / 100);

  if (cap > 0 && feesSoFar >= cap - 0.005) {
    return `${dollars(feesSoFar)} in late fees was added, the most this month can carry`;
  }

  const first =
    feesSoFar > 0.005
      ? `a ${dollars(feesSoFar)} late fee was added`
      : oneTime > 0
        ? `a ${dollars(cap > 0 ? Math.min(oneTime, cap) : oneTime)} late fee applies`
        : "";
  const daily =
    policy.dailyAmount > 0
      ? `${dollars(policy.dailyAmount)}/day${first ? " more" : ""} until paid`
      : "";
  const upTo = cap > 0 && daily ? `, up to ${dollars(cap)}` : "";

  return [first, daily].filter(Boolean).join("; ") + upTo;
}
