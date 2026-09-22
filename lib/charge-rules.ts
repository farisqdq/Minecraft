/**
 * Standing rules about what a tenant owes on top of rent.
 *
 * Two kinds, because two different things were being typed in by hand every
 * month:
 *
 *   "monthly" — something contractual that rides along with rent. The lot fee
 *               at a mobile-home space, pet rent, a reserved parking spot,
 *               trash on a commercial suite. It is owed whether or not rent
 *               was paid, and it is owed every month.
 *
 *   "late"    — a fee that only exists because rent is late. It is assessed
 *               against what is *still owed* once the grace period has run
 *               out, so a tenant who paid on the 3rd never sees it, and a
 *               tenant who paid half sees it once, not twice.
 *
 * A rule is a template. What it produces is an ordinary TenantCharge the
 * landlord can see, delete, or argue with — never a number that only exists
 * inside a calculation.
 *
 * Nothing here touches a database or a clock it wasn't handed.
 */

export type RuleKind = "monthly" | "late";

export type ChargeRule = {
  id: string;
  kind: RuleKind;
  label: string;
  /** Dollars, or a percentage of that month's rent when `percent` is set. */
  amount: number;
  percent: boolean;
  /** "late" only: days after the rent due day before the fee applies. */
  graceDays: number;
  /** Bounds, so a rule can stop without being deleted and losing its history. */
  startMonth: string | null;
  endMonth: string | null;
  active: boolean;
};

const MONTH = /^\d{4}-\d{2}$/;

/** Money, to the cent. */
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * A ceiling on any single automatic charge. A percent rule typed as 50
 * instead of 5, or a flat fee with an extra zero, should not be able to bill
 * a tenant four figures without anybody pressing a button.
 */
export const MAX_AUTO_CHARGE = 2000;

/** Is this rule in force for this month? */
export function ruleAppliesTo(rule: ChargeRule, month: string): boolean {
  if (!rule.active) return false;
  if (!MONTH.test(month)) return false;
  if (rule.startMonth && MONTH.test(rule.startMonth) && month < rule.startMonth) return false;
  if (rule.endMonth && MONTH.test(rule.endMonth) && month > rule.endMonth) return false;
  return true;
}

/**
 * What the rule charges for a month.
 *
 * A percentage of nothing is nothing: a rule set as a percentage produces no
 * charge in a month with no rent, which is what stops a vacant unit or a
 * moved-out tenant from collecting fees.
 */
export function ruleAmount(rule: ChargeRule, rentThisMonth: number): number {
  const base = Math.max(0, rule.amount || 0);
  const raw = rule.percent ? (Math.max(0, rentThisMonth || 0) * base) / 100 : base;
  return cents(Math.min(raw, MAX_AUTO_CHARGE));
}

/** The day of the month a `YYYY-MM` starts on, as a UTC instant. */
function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

/**
 * The moment a late fee for `month` becomes chargeable: the rent due day plus
 * the grace period.
 *
 * A due day past the end of a short month lands on the last day of it rather
 * than spilling into the next — rent due on the 31st is due on the 28th in
 * February, which is how everybody reads it.
 */
export function feeDueAt(month: string, dueDay: number, graceDays: number): Date | null {
  if (!MONTH.test(month)) return null;
  const start = monthStart(month);
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const day = Math.min(Math.max(1, Math.round(dueDay) || 1), lastDay);
  const at = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day + Math.max(0, Math.round(graceDays) || 0))
  );
  return at;
}

/** Has the grace period for `month` run out as of `today`? */
export function graceElapsed(
  month: string,
  dueDay: number,
  graceDays: number,
  today: Date
): boolean {
  const at = feeDueAt(month, dueDay, graceDays);
  if (!at) return false;
  // Strictly past: a fee due at midnight on the 6th is charged on the 6th,
  // not at 00:00 on the 5th because of a timezone.
  return today.getTime() >= at.getTime();
}

export type AssessedFee = { ruleId: string; label: string; amount: number };

/**
 * The late fees owed for one month, given what is still outstanding after
 * rent, manual charges and payments for that month have been counted.
 *
 * Returns nothing when they are square, when the grace period hasn't run out,
 * or when there was no rent to be late with. The amount is never more than
 * what's outstanding: a $50 fee on a $12 shortfall is $12, because charging
 * more than the debt turns a rounding error into a grievance.
 */
export function lateFeesFor(opts: {
  rules: ChargeRule[];
  month: string;
  owed: number;
  rentThisMonth: number;
  dueDay: number;
  today: Date;
}): AssessedFee[] {
  const { rules, month, owed, rentThisMonth, dueDay, today } = opts;
  if (!(owed > 0.005)) return [];
  if (!(rentThisMonth > 0)) return [];

  const out: AssessedFee[] = [];
  for (const rule of rules) {
    if (rule.kind !== "late") continue;
    if (!ruleAppliesTo(rule, month)) continue;
    if (!graceElapsed(month, dueDay, rule.graceDays, today)) continue;
    const amount = Math.min(ruleAmount(rule, rentThisMonth), cents(owed));
    if (amount > 0.005) out.push({ ruleId: rule.id, label: rule.label, amount });
  }
  return out;
}

/**
 * The recurring charges owed for one month. Unconditional: a lot fee is owed
 * whether or not rent was paid, so nothing here looks at a balance.
 *
 * `rentThisMonth` of 0 means the place wasn't let that month — a vacancy or
 * a tenant who had already moved out — and nothing is billed.
 */
export function monthlyChargesFor(opts: {
  rules: ChargeRule[];
  month: string;
  rentThisMonth: number;
}): AssessedFee[] {
  const { rules, month, rentThisMonth } = opts;
  if (!(rentThisMonth > 0)) return [];
  const out: AssessedFee[] = [];
  for (const rule of rules) {
    if (rule.kind !== "monthly") continue;
    if (!ruleAppliesTo(rule, month)) continue;
    const amount = ruleAmount(rule, rentThisMonth);
    if (amount > 0.005) out.push({ ruleId: rule.id, label: rule.label, amount });
  }
  return out;
}

/** "$50 on the 6th" / "5% of rent, 3 days after it's due" — one line for a card. */
export function ruleSummary(rule: ChargeRule, dueDay: number): string {
  const money = rule.percent
    ? `${rule.amount}% of rent`
    : `$${rule.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const day = Math.max(1, Math.round(dueDay) || 1) + Math.round(rule.graceDays);
  const what =
    rule.kind === "monthly"
      ? `${money} every month`
      : rule.graceDays <= 0
        ? `${money} if rent is late`
        : `${money} if rent is still owed on the ${ordinalish(day)}`;
  return `${what}${rule.startMonth ? `, from ${shortMonth(rule.startMonth)}` : ""}${
    rule.endMonth ? ` to ${shortMonth(rule.endMonth)}` : ""
  }`;
}

/** "Sep 2026" from "2026-09". */
function shortMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

/** 1st, 2nd, 3rd, 4th … kept local so this file stays free of imports. */
function ordinalish(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
