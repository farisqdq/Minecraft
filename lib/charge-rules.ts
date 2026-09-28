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
 *               tenant who paid half sees it once, not twice. A late rule can
 *               also add a `dailyAmount` for every further day the month
 *               stays owed, up to `capPercent` of that month's rent — one
 *               charge per day, so the landlord can see and delete each one.
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
  /**
   * "late" only: dollars added for each further day the month stays owed
   * after the first late day. 0 or absent means the fee is one-off.
   */
  dailyAmount?: number;
  /**
   * "late" only: the most this rule charges for one month, one-time fee and
   * daily fees together, as a percentage of that month's rent. 0 or absent
   * means no cap. (Both optional so a rule from before a15 still type-checks.)
   */
  capPercent?: number;
  /** Bounds, so a rule can stop without being deleted and losing its history. */
  startMonth: string | null;
  endMonth: string | null;
  active: boolean;
  /** Kept in step with the company's late-fee policy rather than typed on the tenant. */
  fromPolicy?: boolean;
  /**
   * "late" only: the YYYY-MM-DD the rule started charging. Rent already
   * overdue by then gets its one-time fee on this day (if still owed), and
   * daily fees count only from the day after — a rule switched on today
   * never reaches back and bills the days before it existed. Absent or ""
   * means no such limit.
   */
  accrueFrom?: string;
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

/**
 * How many daily fees one rule may add for one month. A rule with no cap
 * and a tenant who never pays would otherwise keep a row a day forever; a
 * year of them is a collections matter, not bookkeeping.
 */
export const MAX_DAILY_FEES = 366;

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

export type AssessedFee = {
  ruleId: string;
  label: string;
  amount: number;
  /** Set on a per-day fee: the YYYY-MM-DD it is for. Absent on a one-time fee. */
  day?: string;
};

/** A payment by the day it landed, YYYY-MM-DD. */
export type DatedPayment = { day: string; amount: number };

/** A fee a rule has already produced for the month, from its run records. */
export type AppliedFee = { ruleId: string; day: string; amount: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-09-06" from an instant, by the UTC calendar the months use. */
export function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "2026-09-07" from "2026-09-06". */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return dayOf(d);
}

/** "Sep 8" from "2026-09-08", for a charge label. */
function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  if (!m || !d) return day;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
}

/**
 * The late fees owed for one month, given what is still outstanding after
 * rent, manual charges and payments for that month have been counted.
 *
 * Returns nothing when they are square, when the grace period hasn't run out,
 * or when there was no rent to be late with. The amount is never more than
 * what's outstanding: a $50 fee on a $12 shortfall is $12, because charging
 * more than the debt turns a rounding error into a grievance.
 *
 * With `dailyAmount` set, the rule also produces one fee per day after the
 * first late day, for as long as the month stays owed and until the cap is
 * reached. What was owed *on a given day* is reconstructed from the month-end
 * figure and the dated payments: money that arrived later in the month is
 * added back for the days before it, and money that arrived in a later month
 * is taken off from the day it came — later payments clear older rent first.
 * Without `payments` the month-end figure stands for every day.
 *
 * The fees this rule has already put on the month don't count as "still
 * owed" for its own accrual: $5 a day is for rent that hasn't come, and it
 * stops the day the rent does, even if the fees themselves are still open.
 * (They stay owed, and next month reads the balance as it always has.)
 *
 * `applied` is what the rule has already charged for this month (its run
 * records). Those days are skipped and their amounts count toward the cap,
 * so a charge the landlord deleted is a gift to the tenant, not a reset.
 */
export function lateFeesFor(opts: {
  rules: ChargeRule[];
  month: string;
  owed: number;
  rentThisMonth: number;
  dueDay: number;
  today: Date;
  payments?: DatedPayment[];
  applied?: AppliedFee[];
}): AssessedFee[] {
  const { rules, month, owed, rentThisMonth, dueDay, today, payments = [], applied = [] } = opts;
  if (!(rentThisMonth > 0)) return [];

  const inMonth = payments.filter((p) => DAY.test(p.day) && p.day.slice(0, 7) === month);
  const later = payments.filter((p) => DAY.test(p.day) && p.day.slice(0, 7) > month);
  const todayDay = dayOf(today);

  const out: AssessedFee[] = [];
  for (const rule of rules) {
    if (rule.kind !== "late") continue;
    if (!ruleAppliesTo(rule, month)) continue;
    const firstLateAt = feeDueAt(month, dueDay, rule.graceDays);
    if (!firstLateAt || !graceElapsed(month, dueDay, rule.graceDays, today)) continue;

    const runs = applied.filter((a) => a.ruleId === rule.id);
    const done = new Set(runs.map((a) => a.day));
    // Everything charged so far this month, deleted or not, against the cap.
    let charged = runs.reduce((sum, a) => sum + Math.max(0, a.amount || 0), 0);
    const capPercent = rule.capPercent ?? 0;
    const dailyAmount = rule.dailyAmount ?? 0;
    const cap = capPercent > 0 ? cents((rentThisMonth * capPercent) / 100) : Infinity;

    // What they owed on a day, leaving out this rule's own fees: the
    // month-end figure less what this rule has put on it, plus money that
    // came later in the month, less money that came in a later month.
    const charged0 = charged;
    const owedOn = (day: string) => {
      let n = owed - charged0;
      for (const p of inMonth) if (p.day > day) n += Math.max(0, p.amount || 0);
      for (const p of later) if (p.day <= day) n -= Math.max(0, p.amount || 0);
      return cents(n);
    };

    const fee = (wanted: number, day: string) => {
      const room = Math.max(0, cents(cap - charged));
      return cents(Math.min(wanted, room, owedOn(day), MAX_AUTO_CHARGE));
    };

    // The day fees start for this month: the first late day, or the day the
    // rule began charging if that came later. Rent that was already overdue
    // when the rule was switched on is judged as of that day — still owed
    // then, it gets the one-time fee then — and daily fees run from the day
    // after, so switching a policy on never backfills a month of $5 days.
    const accrueFrom = rule.accrueFrom && DAY.test(rule.accrueFrom) ? rule.accrueFrom : "";
    const startDay = accrueFrom && accrueFrom > dayOf(firstLateAt) ? accrueFrom : dayOf(firstLateAt);
    if (startDay > todayDay) continue;

    if (!done.has("")) {
      const amount = fee(ruleAmount(rule, rentThisMonth), startDay);
      if (amount > 0.005) {
        out.push({ ruleId: rule.id, label: rule.label, amount });
        charged = cents(charged + amount);
      }
    }

    if (!(dailyAmount > 0)) continue;
    let day = nextDay(startDay);
    for (let n = 0; n < MAX_DAILY_FEES && day <= todayDay; n++, day = nextDay(day)) {
      if (charged >= cap - 0.005) break;
      if (done.has(day)) continue;
      // Paid: nothing is owed from this day on, and a payment can only make
      // a later day smaller still.
      const amount = fee(dailyAmount, day);
      if (!(amount > 0.005)) break;
      out.push({ ruleId: rule.id, label: `${rule.label} (${shortDay(day)})`, amount, day });
      charged = cents(charged + amount);
    }
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

/**
 * "$50 if rent is still owed on the 6th" / "7% of rent 5 days after it's due,
 * then $5/day up to 12%" — one line for a card.
 */
export function ruleSummary(rule: ChargeRule, dueDay: number): string {
  const money = rule.percent
    ? `${rule.amount}% of rent`
    : `$${rule.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const day = Math.max(1, Math.round(dueDay) || 1) + Math.round(rule.graceDays);
  const dailyAmount = rule.dailyAmount ?? 0;
  const capPercent = rule.capPercent ?? 0;
  const daily = rule.kind === "late" && dailyAmount > 0;
  const cap = rule.kind === "late" && capPercent > 0 ? ` up to ${capPercent}%` : "";
  const what =
    rule.kind === "monthly"
      ? `${money} every month`
      : daily
        ? `${money} ${
            rule.graceDays <= 0 ? "if rent is late" : `${rule.graceDays} days after it's due`
          }, then $${dailyAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })}/day${cap}`
        : rule.graceDays <= 0
          ? `${money} if rent is late${cap}`
          : `${money} if rent is still owed on the ${ordinalish(day)}${cap}`;
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
