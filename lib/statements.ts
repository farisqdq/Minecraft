import { effectivePaymentDay } from "@/lib/rent-month";
import { allocate } from "@/lib/spread";
import { prisma } from "@/lib/prisma";
import { rentForMonth, type RentChangeDTO } from "@/lib/rent";
import { rentTargetOf, unitIdsCountingToward } from "@/lib/rent-target";
import {
  buildStatement,
  resolveStartMonth,
  type ChargeInput,
  type Statement,
} from "@/lib/balance";
import {
  dayOf,
  lateFeesFor,
  monthlyChargesFor,
  type AppliedFee,
  type AssessedFee,
  type ChargeRule,
  type DatedPayment,
} from "@/lib/charge-rules";
import {
  DEFAULT_POLICY,
  parseLateFeeMode,
  parseLeaseType,
  policyCharges,
  policyRuleFields,
  policyRuleMatches,
  type LateFeeMode,
  type LateFeePolicyDTO,
} from "@/lib/late-fee-policy";
// Late fee waivers (a21): a waived month gets no late fees; see lib/late-fee-waiver.ts.
import { lateRulesAfterWaiver, waiversByMonth, type WaiverState } from "@/lib/late-fee-waiver";
import { waiverDTO, type WaiverDTO } from "@/lib/late-fee-waivers-db";

/**
 * Turning a tenant row into a statement: the database half of lib/balance.ts.
 *
 * This is also where standing rules become real charges. There is no cron in
 * this app — it runs on serverless functions, where nothing is awake between
 * requests — so a rule is applied when its statement is worked out, for
 * months that have already begun. A unique index on (ruleId, month, day)
 * means two requests arriving together can't bill the same month — or, for
 * a daily late fee, the same day — twice, and every charge a rule makes is
 * an ordinary row the landlord can see and delete.
 *
 * The company's late-fee policy goes through the same door. It isn't a rule
 * row of its own, so before the rules are read this keeps one `fromPolicy`
 * rule per tenant in step with it (see syncPolicyRule). That keeps a single
 * meaning for TenantCharge.ruleId and TenantRuleRun: a policy fee has a rule
 * behind it, a run record that stops it being billed again, and the same
 * delete button as any other charge.
 */

export type StatementResult = {
  statement: Statement;
  /**
   * Set when the figures can't be trusted for this tenant, with the reason.
   * Better an honest refusal than a confident wrong number about money.
   */
  problem: string;
  startMonth: string;
  openingBalance: number;
  /** Whether the landlord pinned the start, or it was inferred. */
  startPinned: boolean;
  /**
   * Whether these books rest on anything: a payment on file, a start the
   * landlord pinned, an opening balance, a charge. When they don't, the
   * statement is just "this month's rent, unpaid" — true enough for the
   * landlord, who knows what he has and hasn't entered, but not something to
   * put in front of a tenant as their account.
   */
  grounded: boolean;
  charges: {
    id: string;
    month: string;
    kind: string;
    label: string;
    amount: number;
    /** Whether a standing rule made this, rather than a person. */
    automatic: boolean;
  }[];
  rules: (ChargeRule & { dueDay: number })[];
  /** Which late rules bill this tenant: the company policy, their own, or none. */
  lateFeeMode: LateFeeMode;
  /** The company's late-fee policy as it stands, whether or not it applies here. */
  policy: LateFeePolicyDTO;
  /**
   * Late fees on the books per YYYY-MM, from the charges — what a rent-late
   * reminder needs to say "a $70 late fee was added".
   */
  lateFeesByMonth: Record<string, number>;
  /** Late fee waivers (a21): every month waived or un-waived for this tenant. */
  lateFeeWaivers: WaiverDTO[];
  /**
   * The place these books are for, after a single-unit property's whole
   * property has been read as its unit (lib/rent-target.ts) — what a report
   * needs to say why a month expects no rent.
   */
  place: {
    unitId: string | null;
    /** "#A", or "the whole property". */
    label: string;
    wholeProperty: boolean;
    vacant: boolean;
    /** YYYY-MM-DD, or null when not vacant or not recorded. */
    vacantSince: string | null;
    /** Its monthly rent as it stands today. */
    rentSet: number;
  };
  /** Tenant on the whole property of a multi-unit one: the units that carry rent. */
  unitsWithRent: string[];
  /** Other active tenants on the same place, by name. */
  sharedWith: string[];
};

export const monthOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * The month `now` falls in, by the same UTC calendar as monthOf and the
 * late-fee days (dayOf). Reading it from the server's local clock put the
 * statement's last month and "today" in different months for the hours
 * either side of midnight on the 1st wherever the server isn't on UTC.
 */
export const currentMonthOf = (now = new Date()) => monthOf(now);

type RuleRow = {
  id: string;
  kind: string;
  label: string;
  amount: number;
  percent: boolean;
  graceDays: number;
  startMonth: string | null;
  endMonth: string | null;
  active: boolean;
  dailyAmount: number;
  capPercent: number;
  fromPolicy: boolean;
  accrueFrom: string;
};

const ruleDTO = (r: RuleRow): ChargeRule => ({
  id: r.id,
  kind: r.kind === "late" ? "late" : "monthly",
  label: r.label,
  amount: r.amount,
  percent: r.percent,
  graceDays: r.graceDays,
  dailyAmount: r.dailyAmount,
  capPercent: r.capPercent,
  accrueFrom: r.accrueFrom,
  startMonth: r.startMonth,
  endMonth: r.endMonth,
  active: r.active,
  fromPolicy: r.fromPolicy,
});

type PolicyRow = {
  enabled: boolean;
  leaseType: string;
  graceDays: number;
  percent: number;
  dailyAmount: number;
  capPercent: number;
};

/**
 * The policy row as plain data; no row means the defaults (residential,
 * cap 10%), switched off. The LLC's lease type (a22) rides along, so every
 * tenant of the LLC — card, reminder, statement — reads the same numbers.
 */
export const policyDTO = (p: PolicyRow | null): LateFeePolicyDTO =>
  p
    ? {
        enabled: p.enabled,
        leaseType: parseLeaseType(p.leaseType),
        graceDays: p.graceDays,
        percent: p.percent,
        dailyAmount: p.dailyAmount,
        capPercent: p.capPercent,
      }
    : DEFAULT_POLICY;

const RULE_INCLUDE = {
  orderBy: { createdAt: "asc" as const },
  include: { runs: { select: { month: true, day: true, amount: true } } },
};

/**
 * Keep the tenant's `fromPolicy` rule in step with the company policy.
 *
 * The policy applies when the tenant is on "default" and the policy is on
 * and charges something. Then there is exactly one policy rule, active, with
 * the policy's numbers. Otherwise the rule, if it exists, is switched off —
 * never deleted, because its runs are what remember which days it already
 * billed, and a deleted-and-recreated rule would bill them all again.
 *
 * Switching on (first time or after a spell off) starts the rule today
 * (`accrueFrom`). Rent already overdue on that day — this month's or an
 * earlier month's still unpaid — gets the one-time fee straight away, and
 * daily fees count from tomorrow; the days before the policy existed are
 * never billed. Changing the numbers while it's on keeps the start.
 *
 * "Exactly one" has to hold when two requests work out the same tenant at
 * once — the dashboard asking for late-fee statuses while the policy save
 * runs, say. Each used to see no rule and create its own, and every copy
 * then billed the month: $959.70 of late fees on $4,570 instead of $319.90.
 * So the rule is created under a per-tenant lock with a second look inside
 * it, and any copies an earlier race left behind are switched off here
 * (kept, not deleted, for the runs they hold), leaving one in charge.
 */
async function syncPolicyRule(opts: {
  tenantId: string;
  mode: LateFeeMode;
  policy: LateFeePolicyDTO;
  /** Every `fromPolicy` rule the tenant has, oldest first. Normally one. */
  policyRules: RuleRow[];
  /** YYYY-MM-DD, UTC: the day a rule switched on today starts charging. */
  today: string;
}): Promise<boolean> {
  const { tenantId, mode, policy, policyRules, today } = opts;
  const wanted = mode === "default" && policyCharges(policy);
  const fields = policyRuleFields(policy);
  // The one in charge: an active one if any (its runs hold this month's
  // billing), else the oldest.
  const [existing, ...copies] = [...policyRules.filter((r) => r.active), ...policyRules.filter((r) => !r.active)];

  const strayCopies = copies.filter((r) => r.active).map((r) => r.id);
  if (strayCopies.length) {
    await prisma.tenantChargeRule.updateMany({ where: { id: { in: strayCopies } }, data: { active: false } });
  }
  const healed = strayCopies.length > 0;

  if (!wanted) {
    if (existing && existing.active) {
      await prisma.tenantChargeRule.update({ where: { id: existing.id }, data: { active: false } });
      return true;
    }
    return healed;
  }
  if (!existing) {
    // From today, not from the start of the month: overdue rent gets the
    // one-time fee now, and daily fees count from tomorrow (lateFeesFor).
    await prisma.$transaction(async (tx) => {
      // Held until this transaction ends; a request racing this one waits
      // here, then finds the rule this one made and leaves it be.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`policy-rule:${tenantId}`}))`;
      const made = await tx.tenantChargeRule.findFirst({ where: { tenantId, fromPolicy: true }, select: { id: true } });
      if (made) return;
      await tx.tenantChargeRule.create({
        data: { ...fields, tenantId, fromPolicy: true, active: true, startMonth: null, endMonth: null, accrueFrom: today },
      });
    });
    return true;
  }
  // A changed number — including the cap an LLC's lease type (a22) brings —
  // rewrites the rule in place below, start day and runs kept.
  const stale =
    !existing.active ||
    !policyRuleMatches({ ...existing, kind: existing.kind === "late" ? "late" : "monthly" }, policy) ||
    existing.endMonth !== null;
  if (!stale) return healed;
  await prisma.tenantChargeRule.update({
    where: { id: existing.id },
    data: {
      ...fields,
      active: true,
      endMonth: null,
      // Switched back on after a spell off: charging starts again today, and
      // the days it was off are not billed.
      ...(existing.active ? {} : { startMonth: null, accrueFrom: today }),
    },
  });
  return true;
}

export async function statementForTenant(
  tenantId: string,
  now = new Date(),
  opts: {
    /**
     * Treat the tenancy as ending after this month — how a move-out asks
     * "what will they owe if rent stops here?" before it's recorded.
     */
    lastRentMonth?: string;
  } = {}
): Promise<StatementResult | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      property: {
        select: {
          id: true,
          companyId: true,
          monthlyRent: true,
          vacant: true,
          vacantSince: true,
          units: {
            select: { id: true, name: true, monthlyRent: true, vacant: true, vacantSince: true },
            orderBy: { name: "asc" },
          },
        },
      },
      moveOut: { select: { lastRentMonth: true } },
      charges: { orderBy: { createdAt: "asc" } },
      rules: RULE_INCLUDE,
      lateFeeWaivers: { orderBy: { month: "asc" } }, // a21
    },
  });
  if (!tenant) return null;

  const currentMonth = currentMonthOf(now);

  // The company policy, materialised as this tenant's own late rule before
  // the rules are read, so what follows treats it like any other rule. A
  // tenant who has moved out is left alone: their books are closed and the
  // policy has nothing to add to a closed month.
  const policy = policyDTO(
    await prisma.lateFeePolicy.findUnique({ where: { companyId: tenant.property.companyId } })
  );
  const lateFeeMode = parseLateFeeMode(tenant.lateFeeMode);
  if (tenant.active) {
    const changed = await syncPolicyRule({
      tenantId: tenant.id,
      mode: lateFeeMode,
      policy,
      policyRules: tenant.rules.filter((r) => r.fromPolicy),
      today: dayOf(now),
    });
    if (changed) {
      tenant.rules = await prisma.tenantChargeRule.findMany({
        where: { tenantId: tenant.id },
        ...RULE_INCLUDE,
      });
    }
  }

  // Where this tenancy's rent lives. On a single-unit property the whole
  // property is that unit (lib/rent-target.ts): a tenant or a payment on
  // either is the same place, and the unit's rent is what's expected — the
  // figure the dashboard card shows. Anywhere else it's exactly the target
  // the tenant is on.
  const units = tenant.property.units;
  const targetUnitId = rentTargetOf(tenant.unitId, units);
  const unit = units.find((u) => u.id === targetUnitId) ?? null;
  const counted = unitIdsCountingToward(tenant.unitId, units);
  const onTarget = { OR: counted.map((unitId) => ({ unitId })) };

  // Rent lands against a property and optionally a unit, not against a
  // person. If two tenants share exactly the same target, there is no way to
  // say whose money arrived, so say that rather than attribute it twice.
  const others = await prisma.tenant.findMany({
    where: { propertyId: tenant.propertyId, active: true, id: { not: tenant.id }, ...onTarget },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const sharedWith = tenant.active ? others.map((o) => o.name) : [];

  const [payments, rentChanges] = await Promise.all([
    prisma.transaction.findMany({
      where: { propertyId: tenant.propertyId, type: "rent", ...onTarget },
      select: { date: true, amount: true, appliesTo: true, spreadMonths: true },
      orderBy: { date: "asc" },
    }),
    prisma.rentChange.findMany({
      where: { propertyId: tenant.propertyId, unitId: targetUnitId },
      orderBy: { effectiveFrom: "asc" },
    }),
  ]);

  const changeDTOs: RentChangeDTO[] = rentChanges.map((c) => ({
    id: c.id,
    propertyId: c.propertyId,
    unitId: c.unitId,
    effectiveFrom: monthOf(c.effectiveFrom),
    amount: c.amount,
  }));

  const currentRent = unit ? unit.monthlyRent : tenant.property.monthlyRent;
  const placeLabel = unit ? unit.name : "the whole property";
  const place = unit ?? tenant.property;
  // A vacant place expects no rent — but only from when it went vacant, and
  // never for a tenancy that has a recorded end. A move-out marks the place
  // vacant itself; zeroing rent across the whole tenancy because of that
  // would wipe out what the departing tenant still owed. Places marked
  // vacant before the date was recorded keep the old reading: no rent at all.
  const tenancyEnded = Boolean(opts.lastRentMonth) || (!tenant.active && Boolean(tenant.moveOut));
  const vacantFrom =
    place.vacant && !tenancyEnded ? (place.vacantSince ? monthOf(place.vacantSince) : "0000-00") : null;
  const rentFor = (month: string) =>
    vacantFrom !== null && month >= vacantFrom
      ? 0
      : rentForMonth(changeDTOs, tenant.propertyId, targetUnitId, month, currentRent);

  // A spread payment (rent paid months ahead) counts a share toward each of
  // its months, each share on hand from that month's 1st at the earliest.
  const shares = payments.flatMap((p) =>
    allocate({ ...p, type: "rent" }).map((a) => ({ month: a.month, amount: a.amount, date: p.date }))
  );
  const startMonth = resolveStartMonth({
    explicit: tenant.balanceFrom,
    // The earliest month any payment counts toward — not simply the first
    // by date, since a payment can be applied to an earlier month.
    firstPaymentMonth: shares.length ? shares.map((p) => p.month).sort()[0] : null,
    leaseStartMonth: tenant.leaseStart ? monthOf(tenant.leaseStart) : null,
    currentMonth,
  });

  // A tenant who has moved out stops being charged in the month their move-out
  // says. One marked moved out before move-outs were recorded stops at the end
  // of their lease, or at their last payment if no end date was ever set.
  const lastRentMonth = opts.lastRentMonth
    ? opts.lastRentMonth
    : tenant.active
    ? null
    : tenant.moveOut
      ? tenant.moveOut.lastRentMonth
      : tenant.leaseEnd
      ? monthOf(tenant.leaseEnd)
      : payments.length
        ? monthOf(payments[payments.length - 1].date)
        : startMonth;

  // Which late rules are in force is the tenant's lateFeeMode: the policy
  // rule, their own, or none. Monthly rules ride along regardless. The rules
  // the mode sets aside are still returned below, so the panel can show what
  // would apply if the mode changed.
  const inForce = (r: ChargeRule) =>
    r.kind !== "late" ||
    (lateFeeMode === "default"
      ? Boolean(r.fromPolicy)
      : lateFeeMode === "custom"
        ? !r.fromPolicy
        : false);
  // Two active tenants on one place can't both be late with the same rent:
  // there's no telling whose it was, and billing each of them a late fee on
  // it charges the one rent twice. Late fees wait until the books are split
  // (the report says so); monthly charges are each tenant's own and go on.
  const shared = sharedWith.length > 0;
  const rules = tenant.rules
    .map(ruleDTO)
    .filter(inForce)
    .filter((r) => !(shared && r.kind === "late"));
  // A payment counts toward the month it was applied to (lib/rent-month);
  // for late fees, one paid early for a later month was on hand on that
  // month's 1st, and one paid late for an earlier month arrived when it did.
  const paymentInputs = shares.map((p) => ({ month: p.month, amount: p.amount }));
  const datedPayments: DatedPayment[] = shares.map((p) => ({
    day: effectivePaymentDay({ date: p.date, appliesTo: p.month }),
    amount: p.amount,
  }));

  // Work out what the rules imply, write anything missing, then read the
  // charges back — so the statement is built from rows that exist rather than
  // from a calculation that merely agrees with them.
  let charges = tenant.charges;
  if (rules.some((r) => r.active)) {
    const wanted = plannedRuleCharges({
      rules,
      startMonth,
      currentMonth,
      lastRentMonth,
      openingBalance: tenant.openingBalance,
      dueDay: tenant.dueDay,
      today: now,
      rentFor,
      charges: liveCharges(charges),
      ruleCharges: charges.filter((c) => c.ruleId && c.kind !== "credit").map((c) => ({
        ruleId: c.ruleId as string,
        month: c.month,
        amount: c.amount,
      })),
      payments: paymentInputs,
      datedPayments,
      // Late fee waivers (a21): a waived month plans no late fee at all.
      waivers: waiversByMonth(tenant.lateFeeWaivers),
      // A month (or, for a daily fee, a day) a rule has already run for is
      // never revisited — including one whose charge was since deleted.
      // Deleting has to stick, and the run record is what remembers, so the
      // charge itself can go outright. The amounts ride along for the cap.
      applied: tenant.rules.flatMap((r) =>
        r.runs.map((run) => ({ ruleId: r.id, month: run.month, day: run.day, amount: run.amount }))
      ),
    });
    let wrote = false;
    for (const m of wanted) {
      // The run and its charge go in together or not at all. The run's unique
      // index is the lock: if another request got to this month (or day)
      // first, this insert fails, the transaction rolls back, and no second
      // charge exists.
      try {
        await prisma.$transaction([
          prisma.tenantRuleRun.create({
            data: { ruleId: m.ruleId, month: m.month, day: m.day ?? "", amount: m.amount },
          }),
          prisma.tenantCharge.create({
            data: {
              tenantId: tenant.id,
              kind: "fee",
              month: m.month,
              label: m.label,
              amount: m.amount,
              ruleId: m.ruleId,
            },
          }),
        ]);
        wrote = true;
      } catch (e) {
        if ((e as { code?: string })?.code !== "P2002") throw e;
      }
    }
    if (wrote) {
      charges = await prisma.tenantCharge.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "asc" },
      });
    }
  }

  const statement = buildStatement({
    startMonth,
    currentMonth,
    openingBalance: tenant.openingBalance,
    lastRentMonth,
    rentFor,
    charges: liveCharges(charges),
    payments: paymentInputs,
  });

  const lateRuleIds = new Set(tenant.rules.filter((r) => r.kind === "late").map((r) => r.id));
  const lateFeesByMonth: Record<string, number> = {};
  for (const c of charges) {
    if (c.kind === "credit" || !c.ruleId || !lateRuleIds.has(c.ruleId)) continue;
    lateFeesByMonth[c.month] = Math.round(((lateFeesByMonth[c.month] ?? 0) + c.amount) * 100) / 100;
  }

  return {
    statement,
    problem: shared
      ? `${[tenant.name, ...sharedWith].join(" and ")} are ${sharedWith.length === 1 ? "both" : "all"} on ${placeLabel}, so there's no way to tell whose rent arrived. Give each one their own unit, or mark whoever left as moved out.`
      : "",
    startMonth,
    openingBalance: tenant.openingBalance,
    startPinned: Boolean(tenant.balanceFrom),
    grounded:
      payments.length > 0 ||
      Boolean(tenant.balanceFrom) ||
      Math.abs(tenant.openingBalance) > 0.005 ||
      charges.length > 0,
    charges: charges.map((c) => ({
      id: c.id,
      month: c.month,
      kind: c.kind,
      label: c.label,
      amount: c.amount,
      automatic: Boolean(c.ruleId),
    })),
    rules: tenant.rules.map((r) => ({ ...ruleDTO(r), dueDay: tenant.dueDay })),
    lateFeeMode,
    policy,
    lateFeesByMonth,
    lateFeeWaivers: tenant.lateFeeWaivers.map(waiverDTO), // a21
    place: {
      unitId: targetUnitId,
      label: placeLabel,
      wholeProperty: !unit,
      vacant: place.vacant,
      vacantSince: place.vacant && place.vacantSince ? dayOf(place.vacantSince) : null,
      rentSet: currentRent,
    },
    unitsWithRent: unit ? [] : units.filter((u) => u.monthlyRent > 0).map((u) => u.name),
    sharedWith,
  };
}

function liveCharges(
  rows: { month: string; kind: string; amount: number; label: string }[]
): ChargeInput[] {
  return rows.map((c) => ({
      month: c.month,
      kind: c.kind === "credit" ? ("credit" as const) : ("fee" as const),
      amount: c.amount,
      label: c.label,
    }));
}

/**
 * Every charge the standing rules imply for the months on the books.
 *
 * A late fee depends on what was still owed once that month's rent, charges
 * and payments were counted, so this walks the months the same way a
 * statement does — using the engine itself rather than a second copy of the
 * arithmetic that could drift away from it.
 */
function plannedRuleCharges(opts: {
  rules: ChargeRule[];
  startMonth: string;
  currentMonth: string;
  lastRentMonth: string | null;
  openingBalance: number;
  dueDay: number;
  today: Date;
  rentFor: (month: string) => number;
  charges: ChargeInput[];
  /** The charges on the books that a rule made, for what each rule has put on a month. */
  ruleCharges: { ruleId: string; month: string; amount: number }[];
  payments: { month: string; amount: number }[];
  /** The same payments by the day they landed, for what was owed on each day. */
  datedPayments: DatedPayment[];
  /** Every run on record: which months and days each rule has already billed. */
  applied: (AppliedFee & { month: string })[];
  /** Late fee waivers (a21) by YYYY-MM. */
  waivers?: Record<string, WaiverState>;
}): (AssessedFee & { month: string })[] {
  const planned: (AssessedFee & { month: string })[] = [];
  // Keyed exactly as the unique index is, so what the planner skips and what
  // the database would refuse are the same set — not two rules that drift.
  const keys = new Set(opts.applied.map((a) => `${a.ruleId}|${a.month}|${a.day}`));
  const done = (ruleId: string, month: string, day = "") => keys.has(`${ruleId}|${month}|${day}`);

  buildStatement({
    startMonth: opts.startMonth,
    currentMonth: opts.currentMonth,
    openingBalance: opts.openingBalance,
    lastRentMonth: opts.lastRentMonth,
    rentFor: opts.rentFor,
    charges: opts.charges,
    payments: opts.payments,
    assess: (month, owed, rent) => {
      // Recurring first: it is part of what they owe, so a late fee is
      // assessed on rent *and* the lot fee, which is how a lease reads.
      const monthly = monthlyChargesFor({ rules: opts.rules, month, rentThisMonth: rent }).filter(
        (m) => !done(m.ruleId, month)
      );
      const owedWithMonthly = monthly.reduce((sum, m) => sum + m.amount, owed);
      // The late rule does its own skipping by day from `applied`, and needs
      // the amounts already charged to honour the month's cap.
      const late = lateFeesFor({
        // Late fee waivers (a21): no late rules for a waived month; after an
        // un-waive they start again from that day (lib/late-fee-waiver.ts).
        rules: lateRulesAfterWaiver(opts.rules, opts.waivers?.[month]),
        month,
        owed: owedWithMonthly,
        rentThisMonth: rent,
        dueDay: opts.dueDay,
        today: opts.today,
        payments: opts.datedPayments,
        applied: opts.applied.filter((a) => a.month === month),
        booked: bookedFor(opts.ruleCharges, month),
      }).filter((f) => !done(f.ruleId, month, f.day ?? ""));

      const fresh = [...monthly, ...late];
      for (const fee of fresh) planned.push({ ...fee, month });
      return fresh.map((f) => ({
        month,
        kind: "fee" as const,
        amount: f.amount,
        label: f.label,
      }));
    },
  });

  return planned;
}

/** What each rule has on the books for one month, by rule id. */
function bookedFor(rows: { ruleId: string; month: string; amount: number }[], month: string) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.month !== month) continue;
    out[r.ruleId] = Math.round(((out[r.ruleId] ?? 0) + Math.max(0, r.amount || 0)) * 100) / 100;
  }
  return out;
}

/** Just the number, for a list of cards. One query per tenant is fine at this size. */
export async function balancesForTenants(tenantIds: string[], now = new Date()) {
  const out: Record<string, { balance: number; behindSince: string; problem: string }> = {};
  for (const id of tenantIds) {
    const result = await statementForTenant(id, now);
    if (!result) continue;
    out[id] = {
      balance: result.statement.balance,
      behindSince: result.statement.behindSince,
      problem: result.problem,
    };
  }
  return out;
}
