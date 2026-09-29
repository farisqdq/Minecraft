import { prisma } from "@/lib/prisma";
import { statementForTenant } from "@/lib/statements";
import { lateFeeLine, type LateFeeLine } from "@/lib/late-fee-report";
import { dayOf } from "@/lib/charge-rules";

/**
 * Applying late fees now, rather than waiting for a page to be opened.
 *
 * A fee is written when a tenant's statement is worked out (lib/statements),
 * under a run record per month and per day, so calling this any number of
 * times — the daily job, a save, the "Run late fees now" button, two at once
 * — writes each fee once. This just makes sure every tenant it should
 * reach gets their statement worked out, and says what happened.
 */
export async function runLateFeesFor(tenantIds: string[], now = new Date()): Promise<LateFeeLine[]> {
  const lines: LateFeeLine[] = [];
  const today = dayOf(now);
  for (const id of tenantIds) {
    const before = await lateFeesByMonth(id);
    const result = await statementForTenant(id, now).catch((err) => {
      console.error("Late fees", id, err);
      return null;
    });
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { name: true, dueDay: true, rules: { where: { kind: "late", active: true }, select: { fromPolicy: true, graceDays: true } } },
    });
    if (!result || !tenant) continue;
    const after = await lateFeesByMonth(id);
    const addedByMonth: Record<string, number> = {};
    for (const [m, v] of Object.entries(after)) {
      const d = Math.round((v - (before[m] ?? 0)) * 100) / 100;
      if (d > 0.005) addedByMonth[m] = d;
    }
    const added = Math.round(Object.values(addedByMonth).reduce((a, b) => a + b, 0) * 100) / 100;
    const s = result.statement;
    const month = s.behindSince || today.slice(0, 7);
    const row = s.rows.find((r) => r.month === month);
    const own = tenant.rules.filter((r) => !r.fromPolicy);
    const grace =
      result.lateFeeMode === "custom" && own.length > 0
        ? Math.min(...own.map((r) => r.graceDays))
        : result.policy.graceDays;
    const feesThisMonth = result.lateFeesByMonth[month] ?? 0;
    const cap = result.lateFeeMode === "default" && result.policy.capPercent > 0 && row ? (row.rent * result.policy.capPercent) / 100 : Infinity;
    lines.push(
      lateFeeLine({
        tenantName: tenant.name,
        mode: result.lateFeeMode,
        policyOn: result.policy.enabled,
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
        capped: feesThisMonth >= cap - 0.005,
        waived: result.lateFeeWaivers.some((w) => w.waived && w.month === month), // a21
      })
    );
  }
  return lines;
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
