/**
 * One line per tenant after a late-fee run: what was charged, or exactly why
 * nothing was. Pure, so every reason is tested; lib/late-fees-db.ts gathers
 * the facts.
 */
import { money } from "./money.ts";
import { monthName } from "./notices.ts";
import { feeDueAt } from "./charge-rules.ts";
import type { LateFeeMode } from "./late-fee-policy.ts";

export type LateFeeFacts = {
  tenantName: string;
  mode: LateFeeMode;
  policyOn: boolean;
  /** Tenant on their own rules: whether any active late rule exists. */
  ownLateRule: boolean;
  /** Late fees written by this run. */
  added: number;
  /** The same, by month, when more than one month was charged. */
  addedByMonth?: Record<string, number>;
  /** Late fees on the books for the month being chased, after the run. */
  feesThisMonth: number;
  /** The month being chased: the oldest unpaid month, or the current one. */
  month: string;
  balance: number;
  rentThisMonth: number;
  dueDay: number;
  graceDays: number;
  /** YYYY-MM-DD */
  today: string;
  /** Set when the statement can't tell whose rent is whose. */
  problem: string;
  /** Late fees for the month would exceed nothing more: the cap is reached. */
  capped: boolean;
};

export type LateFeeLine = { tenantName: string; tone: "charged" | "none" | "check"; text: string };

export function lateFeeLine(f: LateFeeFacts): LateFeeLine {
  const who = f.tenantName;
  const line = (tone: LateFeeLine["tone"], text: string): LateFeeLine => ({ tenantName: who, tone, text });

  if (f.added > 0.005) {
    const months = Object.entries(f.addedByMonth ?? {}).filter(([, v]) => v > 0.005).sort(([a], [b]) => a.localeCompare(b));
    const detail =
      months.length > 1
        ? months.map(([m, v]) => `${money(v)} for ${monthName(m)}`).join(", ")
        : `${money(f.feesThisMonth)} for ${monthName(f.month)} so far`;
    return line("charged", `${money(f.added)} in late fees added now (${detail}).`);
  }
  if (f.mode === "off") return line("none", "Set to no late fees on their account.");
  if (f.mode === "custom" && !f.ownLateRule) {
    return line("check", "Set to their own late-fee rules, but none is active — so nothing is charged. Switch them to the LLC's policy on their statement.");
  }
  if (f.mode === "default" && !f.policyOn) return line("none", "The LLC's late fees are switched off.");
  if (f.balance <= 0.005) return line("none", "Paid up — nothing owed.");
  if (f.problem) return line("check", f.problem);
  if (!(f.rentThisMonth > 0)) return line("none", `No rent is expected for ${monthName(f.month)} (marked vacant), so no late fee.`);
  const firstLate = feeDueAt(f.month, f.dueDay, f.graceDays);
  if (firstLate && firstLate.toISOString().slice(0, 10) > f.today) {
    const on = firstLate.toISOString().slice(0, 10);
    return line("none", `${money(f.balance)} owed, still inside the grace period — the fee applies on ${formatShort(on)} if it's still unpaid.`);
  }
  if (f.capped || f.feesThisMonth > 0.005) {
    return line(
      "none",
      f.capped
        ? `${money(f.feesThisMonth)} in late fees for ${monthName(f.month)} already — the most the month can carry.`
        : `${money(f.feesThisMonth)} in late fees for ${monthName(f.month)} so far; nothing more is due today.`
    );
  }
  return line("check", `${money(f.balance)} owed, but no late fee applies to it — the debt predates the rent on the books (an opening balance), which late fees don't cover.`);
}

function formatShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
