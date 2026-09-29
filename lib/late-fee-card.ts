/**
 * What a dashboard property card says about a month's late fees.
 *
 * The card used to judge a month on rent alone, so a tenant who paid the
 * rent but not the $319.90 fee on top read as "Paid" there while their
 * statement and Needs attention said they still owed it. Everything the card
 * decides about fees lives here so the two can't drift apart again, and so
 * it can be tested without a browser.
 *
 * Pure: no database, no clock (today is passed in), relative imports only.
 */

import { money } from "./money.ts";
import { graceElapsed } from "./charge-rules.ts";
import type { LateFeePolicyDTO } from "./late-fee-policy.ts";

/** Half a cent: below this, an amount is square. Matches Needs attention. */
const EPSILON = 0.005;

const cents = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/**
 * What is still owed for the month: rent plus that month's late fees, less
 * what came in. A rent payment goes against fees the same way it does on the
 * tenant's statement, so the two add up to one figure.
 */
export function shortAmount(opts: { rent: number; paid: number; fees: number }): number {
  return Math.max(0, cents(opts.rent + Math.max(0, opts.fees) - opts.paid));
}

/** Rent and the month's fees are both covered. A month with no rent due is never "paid". */
export function isPaidUp(opts: { rent: number; paid: number; fees: number }): boolean {
  return opts.rent > 0 && shortAmount(opts) < EPSILON;
}

/** The fee cap in dollars for a month's rent; null when the policy has none. */
export function capFor(policy: Pick<LateFeePolicyDTO, "capPercent">, rent: number): number | null {
  return policy.capPercent > 0 && rent > 0 ? cents((rent * policy.capPercent) / 100) : null;
}

/**
 * The line under the rent bar, or "" when there are no fees:
 *
 *   LLC policy:  "Late fees $319.90 (7% + $5/day, cap $548.40) · 58% of cap"
 *   own rules:   "Late fees $319.90"
 *
 * The policy's terms are there because "$319.90" alone invites "why that
 * much?", and the share of the cap answers "how much worse can it get?".
 * Parts that are zero are left out rather than printed as "+ $0/day".
 *
 * `mode` is the tenant's lateFeeMode; only "default" (the LLC policy) gets
 * the terms, since a tenant on their own rules isn't charged by them.
 */
export function cardLateFeeLine(opts: {
  fees: number;
  rent: number;
  policy: LateFeePolicyDTO | null;
  mode: string;
}): string {
  const fees = cents(opts.fees);
  if (!(fees > 0)) return "";
  const head = `Late fees ${money(fees)}`;
  const p = opts.policy;
  if (opts.mode !== "default" || !p) return head;

  const charge: string[] = [];
  if (p.percent > 0) charge.push(pct(p.percent));
  if (p.dailyAmount > 0) charge.push(`${money(cents(p.dailyAmount))}/day`);
  const terms: string[] = [];
  if (charge.length) terms.push(charge.join(" + "));
  const cap = capFor(p, opts.rent);
  if (cap !== null) terms.push(`cap ${money(cap)}`);

  let line = terms.length ? `${head} (${terms.join(", ")})` : head;
  if (cap !== null) {
    // Floored, so a month a few cents short of the cap never reads "100%".
    line += fees >= cap - EPSILON ? " · cap reached" : ` · ${Math.floor((fees / cap) * 100)}% of cap`;
  }
  return line;
}

/**
 * Should the card ask the server why a short month has no late fee yet?
 *
 * Only when there is something to explain: rent is due, it isn't covered,
 * no fee is on the books, and the grace period (due day + graceDays, the
 * same instant the fee engine uses) has run out. A future month, or one
 * still inside its grace period, is expected to have no fee.
 *
 * `today` is "YYYY-MM-DD".
 */
export function needsStatusCheck(opts: {
  rent: number;
  paid: number;
  fees: number;
  dueDay: number;
  graceDays: number;
  month: string;
  today: string;
}): boolean {
  if (!(opts.rent > 0) || opts.fees > 0) return false;
  if (isPaidUp(opts)) return false;
  if (opts.month > opts.today.slice(0, 7)) return false;
  const today = new Date(`${opts.today}T00:00:00.000Z`);
  if (isNaN(today.getTime())) return false;
  return graceElapsed(opts.month, opts.dueDay, opts.graceDays, today);
}

/** One tenant's answer from POST /api/late-fees/status. */
export type LateFeeStatus = {
  month: string;
  fees: number;
  cap: number | null;
  line: { tenantName: string; tone: "charged" | "none" | "check"; text: string };
};

/**
 * Pulls the usable part out of a status response, ignoring anything
 * malformed — the endpoint belongs to another part of the app and a card
 * should say nothing rather than break on a shape it didn't expect.
 */
export function parseStatuses(body: unknown): Record<string, LateFeeStatus> {
  const out: Record<string, LateFeeStatus> = {};
  const statuses = (body as { statuses?: unknown } | null)?.statuses;
  if (!statuses || typeof statuses !== "object") return out;
  for (const [id, raw] of Object.entries(statuses as Record<string, unknown>)) {
    const s = raw as Partial<LateFeeStatus> | null;
    if (!s || typeof s.month !== "string" || typeof s.fees !== "number" || !Number.isFinite(s.fees)) continue;
    const line = s.line && typeof s.line === "object" ? s.line : null;
    out[id] = {
      month: s.month,
      fees: s.fees,
      cap: typeof s.cap === "number" ? s.cap : null,
      line: {
        tenantName: typeof line?.tenantName === "string" ? line.tenantName : "",
        tone: line?.tone === "charged" || line?.tone === "none" || line?.tone === "check" ? line.tone : "check",
        text: typeof line?.text === "string" ? line.text : "",
      },
    };
  }
  return out;
}

/**
 * Fees for the month once a status has come back: the server's figure when
 * it found fees for this very month the page didn't know about, otherwise
 * what the page already had.
 */
export function mergedFees(known: number, status: LateFeeStatus | undefined, month: string): number {
  if (status && status.month === month && status.fees > 0) return Math.max(known, cents(status.fees));
  return known;
}

/** The muted line under the bar when the server explains a missing fee, or "". */
export function noFeeLine(status: LateFeeStatus | undefined, month: string): string {
  // A status about another month says nothing about this one.
  if (!status || status.month !== month || status.fees > 0) return "";
  const text = status.line.text.trim();
  return text ? `No late fee: ${text}` : "";
}

export const NO_TENANT_LINE = "No tenant on this unit — late fees need one";
