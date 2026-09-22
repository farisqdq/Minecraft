import { prisma } from "@/lib/prisma";
import { rentForMonth, type RentChangeDTO } from "@/lib/rent";
import {
  buildStatement,
  resolveStartMonth,
  type ChargeInput,
  type Statement,
} from "@/lib/balance";
import {
  lateFeesFor,
  monthlyChargesFor,
  type AssessedFee,
  type ChargeRule,
} from "@/lib/charge-rules";

/**
 * Turning a tenant row into a statement: the database half of lib/balance.ts.
 *
 * This is also where standing rules become real charges. There is no cron in
 * this app — it runs on serverless functions, where nothing is awake between
 * requests — so a rule is applied when its statement is worked out, for
 * months that have already begun. A unique index on (ruleId, month) means two
 * requests arriving together can't bill the same month twice, and every
 * charge a rule makes is an ordinary row the landlord can see and delete.
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
};

export const monthOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export const currentMonthOf = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

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
};

const ruleDTO = (r: RuleRow): ChargeRule => ({
  id: r.id,
  kind: r.kind === "late" ? "late" : "monthly",
  label: r.label,
  amount: r.amount,
  percent: r.percent,
  graceDays: r.graceDays,
  startMonth: r.startMonth,
  endMonth: r.endMonth,
  active: r.active,
});

export async function statementForTenant(
  tenantId: string,
  now = new Date()
): Promise<StatementResult | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      property: { select: { id: true, monthlyRent: true, vacant: true } },
      unit: { select: { id: true, monthlyRent: true, vacant: true } },
      charges: { orderBy: { createdAt: "asc" } },
      rules: {
        orderBy: { createdAt: "asc" },
        include: { runs: { select: { month: true } } },
      },
    },
  });
  if (!tenant) return null;

  const currentMonth = currentMonthOf(now);

  // Rent lands against a property and optionally a unit, not against a
  // person. If two tenants share exactly the same target, there is no way to
  // say whose money arrived, so say that rather than attribute it twice.
  const sharing = await prisma.tenant.count({
    where: { propertyId: tenant.propertyId, unitId: tenant.unitId, active: true },
  });

  const [payments, rentChanges] = await Promise.all([
    prisma.transaction.findMany({
      where: { propertyId: tenant.propertyId, unitId: tenant.unitId, type: "rent" },
      select: { date: true, amount: true },
      orderBy: { date: "asc" },
    }),
    prisma.rentChange.findMany({
      where: { propertyId: tenant.propertyId, unitId: tenant.unitId },
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

  const currentRent = tenant.unit ? tenant.unit.monthlyRent : tenant.property.monthlyRent;
  const vacant = tenant.unit ? tenant.unit.vacant : tenant.property.vacant;
  const rentFor = (month: string) =>
    vacant ? 0 : rentForMonth(changeDTOs, tenant.propertyId, tenant.unitId, month, currentRent);

  const startMonth = resolveStartMonth({
    explicit: tenant.balanceFrom,
    firstPaymentMonth: payments.length ? monthOf(payments[0].date) : null,
    leaseStartMonth: tenant.leaseStart ? monthOf(tenant.leaseStart) : null,
    currentMonth,
  });

  // A tenant who has moved out stops being charged at the end of their lease,
  // or at their last payment if no end date was ever recorded.
  const lastRentMonth = tenant.active
    ? null
    : tenant.leaseEnd
      ? monthOf(tenant.leaseEnd)
      : payments.length
        ? monthOf(payments[payments.length - 1].date)
        : startMonth;

  const rules = tenant.rules.map(ruleDTO);
  const paymentInputs = payments.map((p) => ({ month: monthOf(p.date), amount: p.amount }));

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
      payments: paymentInputs,
      // A month a rule has already run for is never revisited — including one
      // whose charge was since deleted. Deleting has to stick, and the run
      // record is what remembers, so the charge itself can go outright.
      already: new Set(
        tenant.rules.flatMap((r) => r.runs.map((run) => `${r.id}|${run.month}`))
      ),
    });
    let wrote = false;
    for (const m of wanted) {
      // The run and its charge go in together or not at all. The run's unique
      // index is the lock: if another request got to this month first, this
      // insert fails, the transaction rolls back, and no second charge exists.
      try {
        await prisma.$transaction([
          prisma.tenantRuleRun.create({
            data: { ruleId: m.ruleId, month: m.month, amount: m.amount },
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

  return {
    statement,
    problem:
      sharing > 1
        ? "Two tenants share this property without units, so there's no way to tell whose rent arrived. Give each one a unit to split the books."
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
  payments: { month: string; amount: number }[];
  /** "ruleId|month" for every month a rule has already run for. */
  already: Set<string>;
}): (AssessedFee & { month: string })[] {
  const planned: (AssessedFee & { month: string })[] = [];
  // Keyed exactly as the unique index is, so what the planner skips and what
  // the database would refuse are the same set — not two rules that drift.
  const done = (ruleId: string, month: string) => opts.already.has(`${ruleId}|${month}`);

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
      const late = lateFeesFor({
        rules: opts.rules,
        month,
        owed: owedWithMonthly,
        rentThisMonth: rent,
        dueDay: opts.dueDay,
        today: opts.today,
      }).filter((f) => !done(f.ruleId, month));

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
