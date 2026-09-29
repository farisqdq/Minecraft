import { prisma } from "@/lib/prisma";
import { currentMonthOf, statementForTenant, type StatementResult } from "@/lib/statements";
import { lateFeeLine, type LateFeeLine } from "@/lib/late-fee-report";
import { dayOf } from "@/lib/charge-rules";
import { policyCharges } from "@/lib/late-fee-policy";

/**
 * Applying late fees now, rather than waiting for a page to be opened.
 *
 * A fee is written when a tenant's statement is worked out (lib/statements),
 * under a run record per month and per day, so calling this any number of
 * times — the daily job, a save, the "Run late fees now" button, the
 * dashboard asking for statuses, several at once — writes each fee once.
 * This just makes sure every tenant it should reach gets their statement
 * worked out, and says what happened.
 */

export type LateFeeStatus = {
  tenantId: string;
  /** YYYY-MM: the month the figures and the line are about. */
  month: string;
  /** Late fees on the books for that month, after this run. */
  fees: number;
  /** The most late fees that month can carry under the rules in force, in dollars; null for no cap. */
  cap: number | null;
  line: LateFeeLine;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Apply late fees for these tenants and describe each one.
 *
 * `focus` picks the month a line is about: "behind" chases the oldest unpaid
 * month (what a run report wants: where the debt started), "current" the
 * month we're in (what a dashboard card showing this month's rent wants).
 */
export async function lateFeeStatuses(
  tenantIds: string[],
  now = new Date(),
  focus: "behind" | "current" = "behind"
): Promise<LateFeeStatus[]> {
  const out: LateFeeStatus[] = [];
  const today = dayOf(now);
  const currentMonth = currentMonthOf(now);
  for (const id of tenantIds) {
    const before = await lateFeesByMonth(id);
    const result = await statementForTenant(id, now).catch((err) => {
      console.error("Late fees", id, err);
      return null;
    });
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        name: true,
        dueDay: true,
        active: true,
        property: { select: { companyId: true, company: { select: { name: true } } } },
        rules: {
          where: { kind: "late", active: true },
          select: { fromPolicy: true, graceDays: true, label: true, startMonth: true, endMonth: true },
        },
      },
    });
    if (!result || !tenant) continue;
    const after = await lateFeesByMonth(id);
    const addedByMonth: Record<string, number> = {};
    for (const [m, v] of Object.entries(after)) {
      const d = cents(v - (before[m] ?? 0));
      if (d > 0.005) addedByMonth[m] = d;
    }
    const added = cents(Object.values(addedByMonth).reduce((a, b) => a + b, 0));
    const s = result.statement;
    const month = focus === "current" ? currentMonth : s.behindSince || currentMonth;
    const row = s.rows.find((r) => r.month === month);
    const own = tenant.rules.filter((r) => !r.fromPolicy);
    const grace =
      result.lateFeeMode === "custom" && own.length > 0
        ? Math.min(...own.map((r) => r.graceDays))
        : result.policy.graceDays;
    const feesThisMonth = result.lateFeesByMonth[month] ?? 0;
    const cap = capFor(result, month, row?.rent ?? 0);
    const policyOnFor =
      result.lateFeeMode === "default" && !policyCharges(result.policy)
        ? await policyOnElsewhere(tenant.property.companyId)
        : [];
    out.push({
      tenantId: id,
      month,
      fees: feesThisMonth,
      cap,
      line: lateFeeLine({
        tenantName: tenant.name,
        mode: result.lateFeeMode,
        policyOn: policyCharges(result.policy),
        ownLateRule: own.length > 0,
        added,
        addedByMonth,
        feesThisMonth,
        month,
        balance: s.balance,
        rentThisMonth: row?.rent ?? 0,
        dueDay: tenant.dueDay,
        graceDays: grace,
        today,
        problem: result.problem,
        capped: cap !== null && feesThisMonth >= cap - 0.005,
        waived: result.lateFeeWaivers.some((w) => w.waived && w.month === month), // a21
        active: tenant.active,
        companyName: tenant.property.company.name,
        policyOnFor,
        ownRules: own.map((r) => ({ label: r.label, startMonth: r.startMonth, endMonth: r.endMonth })),
        startMonth: result.startMonth,
        startPinned: result.startPinned,
        place: result.place,
        unitsWithRent: result.unitsWithRent,
        sharedWith: result.sharedWith,
        paidThisMonth: row?.paid ?? 0,
        deletedThisMonth: await deletedLateFees(id, result, month),
      }),
    });
  }
  return out;
}

export async function runLateFeesFor(tenantIds: string[], now = new Date()): Promise<LateFeeLine[]> {
  return (await lateFeeStatuses(tenantIds, now, "behind")).map((s) => s.line);
}

/**
 * The most late fees a month can carry for this tenant, in dollars, or null
 * for no ceiling. On the LLC's policy it's the policy's cap on that month's
 * rent; on their own rules, the rules' caps added up — null if any rule
 * covering the month has none; with no late fees at all, null.
 */
function capFor(result: StatementResult, month: string, rent: number): number | null {
  if (result.lateFeeMode === "default") {
    if (!policyCharges(result.policy) || !(result.policy.capPercent > 0)) return null;
    return cents((rent * result.policy.capPercent) / 100);
  }
  if (result.lateFeeMode === "off") return null;
  const covering = result.rules.filter(
    (r) =>
      r.kind === "late" &&
      r.active &&
      !r.fromPolicy &&
      !(r.startMonth && month < r.startMonth) &&
      !(r.endMonth && month > r.endMonth)
  );
  if (covering.length === 0 || covering.some((r) => !((r.capPercent ?? 0) > 0))) return null;
  return cents(covering.reduce((sum, r) => sum + (rent * (r.capPercent ?? 0)) / 100, 0));
}

/** What the late rules in force charged for the month that is no longer on the books. */
async function deletedLateFees(tenantId: string, result: StatementResult, month: string): Promise<number> {
  const runs = await prisma.tenantRuleRun.aggregate({
    where: { month, rule: { tenantId, kind: "late" } },
    _sum: { amount: true },
  });
  return Math.max(0, cents((runs._sum.amount ?? 0) - (result.lateFeesByMonth[month] ?? 0)));
}

/** LLCs sharing a team member with this one whose late-fee policy is on. */
async function policyOnElsewhere(companyId: string): Promise<string[]> {
  const members = await prisma.companyMember.findMany({ where: { companyId }, select: { userId: true } });
  const rows = await prisma.lateFeePolicy.findMany({
    where: {
      enabled: true,
      companyId: { not: companyId },
      company: { members: { some: { userId: { in: members.map((m) => m.userId) } } } },
    },
    select: { company: { select: { name: true } } },
  });
  return rows.map((r) => r.company.name).sort();
}

async function lateFeesByMonth(tenantId: string): Promise<Record<string, number>> {
  const rows = await prisma.tenantCharge.groupBy({
    by: ["month"],
    where: { tenantId, kind: "fee", rule: { kind: "late" } },
    _sum: { amount: true },
  });
  return Object.fromEntries(rows.map((r) => [r.month, r._sum.amount ?? 0]));
}

/** Every active tenant of one LLC. */
export async function runLateFeesForCompany(companyId: string, now = new Date()) {
  const tenants = await prisma.tenant.findMany({
    where: { active: true, property: { companyId } },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return runLateFeesFor(tenants.map((t) => t.id), now);
}

/**
 * The daily job's share: every active tenant a late fee could reach — in an
 * LLC whose policy is on, or with a late rule of their own. Independent of
 * reminders, which only some LLCs turn on.
 */
export async function runDailyLateFees(now = new Date()) {
  const tenants = await prisma.tenant.findMany({
    where: {
      active: true,
      OR: [
        { lateFeeMode: "default", property: { company: { lateFeePolicy: { enabled: true } } } },
        { lateFeeMode: "custom", rules: { some: { kind: "late", active: true, fromPolicy: false } } },
      ],
    },
    select: { id: true },
  });
  const lines = await runLateFeesFor(tenants.map((t) => t.id), now);
  return { tenants: tenants.length, charged: lines.filter((l) => l.tone === "charged").length };
}
