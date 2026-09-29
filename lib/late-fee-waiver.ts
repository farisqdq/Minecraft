/**
 * "Waive late fee for this month": which late fees a waiver stops, which it
 * removes, and what taking it back does. Pure — no database, no clock it
 * isn't handed, relative imports only — so every rule here is tested
 * (tests/late-fee-waiver.test.ts). lib/late-fee-waivers-db.ts does the writes
 * and lib/statements.ts applies `lateRulesAfterWaiver` when it plans fees.
 *
 * A waiver is one tenant and one rent month. Nothing else moves: not the
 * LLC's policy, not the tenant's lateFeeMode, not their other months, not
 * other tenants. Monthly rules (a lot fee) are not late fees and carry on.
 *
 * Waiving:
 *   - every late fee already on that month (policy or the tenant's own late
 *     rule, one-time and daily) is deleted;
 *   - the TenantRuleRun rows behind them are kept, as with any deleted fee;
 *   - while it stands, no late fee is planned for that month at all — the
 *     daily job, "Run late fees now", a statement load and the status check
 *     all go through the same planner, so none of them can put one back.
 *
 * Un-waiving (untick on the rent entry, or "Remove waiver" on the statement)
 * keeps the row, stamped with the day, and treats the month as if its late
 * rules had started on that day (the same meaning as a rule's `accrueFrom`):
 *   - the one-time fee comes back on that day only if rent is still owed
 *     then — it is judged afresh, like a policy switched on that day;
 *   - daily fees run from the day after; the waived days are never billed;
 *   - the month's run records are cleared at that moment (they only held
 *     fees the waiver removed), so the cap counts only fees charged after
 *     the un-waive and the month can never carry more than the cap.
 * Waiving again later removes what accrued since, the same way.
 */
import { dayOf, type ChargeRule } from "./charge-rules.ts";

export type WaiverState = {
  month: string;
  /** When it was waived. */
  waivedAt: Date | string;
  waivedByName?: string;
  note?: string | null;
  /** When it was taken back; null/undefined while it stands. */
  unwaivedAt?: Date | string | null;
  unwaivedByName?: string;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A rent month as the waiver stores it, or "" if it isn't one. */
export function waiverMonth(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().slice(0, 7) : "";
  return MONTH.test(s) ? s : "";
}

/** The month a rent entry dated `YYYY-MM-DD` (or a Date) is for. */
export function monthOfEntry(date: string | Date): string {
  return waiverMonth(typeof date === "string" ? date : dayOf(date));
}

const asDate = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);

/** Is the month waived right now? */
export function isWaived(w: WaiverState | null | undefined): boolean {
  return Boolean(w) && !w!.unwaivedAt;
}

/** The YYYY-MM-DD late fees start again after an un-waive, or "" if there wasn't one. */
export function resumeDay(w: WaiverState | null | undefined): string {
  return w && w.unwaivedAt ? dayOf(asDate(w.unwaivedAt)) : "";
}

/**
 * The rules to plan one month's late fees with, given its waiver (if any).
 *
 * Waived: no late rule at all, so nothing — not the one-time fee, not a day
 * of $5 — is planned. Un-waived: each late rule starts no earlier than the
 * day it was un-waived. No waiver: the rules as they are. Monthly rules are
 * passed through untouched either way.
 */
export function lateRulesAfterWaiver(rules: ChargeRule[], w: WaiverState | null | undefined): ChargeRule[] {
  if (!w) return rules;
  if (isWaived(w)) return rules.filter((r) => r.kind !== "late");
  const from = resumeDay(w);
  return rules.map((r) =>
    r.kind === "late" && (!r.accrueFrom || r.accrueFrom < from) ? { ...r, accrueFrom: from } : r
  );
}

/** Waivers by month, for one tenant. */
export function waiversByMonth<T extends WaiverState>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) out[r.month] = r;
  return out;
}

/** "tenantId|YYYY-MM" → true for every month currently waived — what the dashboard reads. */
export function waivedKeys(rows: (WaiverState & { tenantId: string })[]): Record<string, true> {
  const out: Record<string, true> = {};
  for (const r of rows) if (isWaived(r)) out[`${r.tenantId}|${r.month}`] = true;
  return out;
}

type ChargeLike = { id: string; month: string; kind: string; ruleId: string | null };

/**
 * The charges waiving `month` deletes: late fees a late rule wrote for that
 * month. Not a monthly rule's charge, not anything typed by hand (a manual
 * "late fee" is the landlord's own decision to undo), not another month.
 */
export function chargesToRemove(charges: ChargeLike[], lateRuleIds: Set<string>, month: string): string[] {
  return charges
    .filter((c) => c.month === month && c.kind !== "credit" && c.ruleId && lateRuleIds.has(c.ruleId))
    .map((c) => c.id);
}

type RunLike = { ruleId: string; month: string; day: string };

/**
 * The run records un-waiving `month` clears: that month's, for late rules.
 * Kept while waived so nothing could re-bill them; cleared on un-waive
 * because from then on the month starts again at the un-waive day, and the
 * one-time fee's "" key must be free for it to come back if still owed.
 * Days before the un-waive stay unbilled because of `lateRulesAfterWaiver`,
 * not because of these rows.
 */
export function runsToClear<T extends RunLike>(runs: T[], lateRuleIds: Set<string>, month: string): T[] {
  return runs.filter((r) => r.month === month && lateRuleIds.has(r.ruleId));
}

/** "Late fee waived by Dana on Sep 29" — the statement's one line of provenance. */
export function waiverLine(w: WaiverState): string {
  const d = asDate(w.waivedAt);
  const on = isNaN(d.getTime())
    ? ""
    : ` on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  return `Late fee waived${w.waivedByName ? ` by ${w.waivedByName}` : ""}${on}`;
}
