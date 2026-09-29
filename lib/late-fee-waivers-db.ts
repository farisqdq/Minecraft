import { prisma } from "@/lib/prisma";
import { requireTenant } from "@/lib/access";
import { chargesToRemove, runsToClear, waivedKeys } from "@/lib/late-fee-waiver";
import { unitIdsCountingToward } from "@/lib/rent-target";

/**
 * The writes behind "Waive late fee for this month". What each one means is
 * in lib/late-fee-waiver.ts; lib/statements.ts reads the rows when it plans
 * fees, so nothing here has to stop a fee being written later.
 *
 * Access is the tenant's: anyone on the LLC's team (requireTenant), because
 * letting a late fee go is an ordinary collection call, not an owner's. The
 * person is recorded, by id and by name.
 */

export type WaiverDTO = {
  month: string;
  waived: boolean;
  waivedAt: string;
  waivedByName: string;
  note: string;
  unwaivedAt: string;
  unwaivedByName: string;
};

type WaiverRow = {
  month: string;
  waivedAt: Date;
  waivedByName: string;
  note: string | null;
  unwaivedAt: Date | null;
  unwaivedByName: string;
};

export const waiverDTO = (w: WaiverRow): WaiverDTO => ({
  month: w.month,
  waived: !w.unwaivedAt,
  waivedAt: w.waivedAt.toISOString(),
  waivedByName: w.waivedByName,
  note: w.note ?? "",
  unwaivedAt: w.unwaivedAt ? w.unwaivedAt.toISOString() : "",
  unwaivedByName: w.unwaivedByName,
});

async function nameOf(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name || u?.email || "";
}

async function lateRuleIdsOf(tenantId: string) {
  const rules = await prisma.tenantChargeRule.findMany({
    where: { tenantId, kind: "late" },
    select: { id: true },
  });
  return new Set(rules.map((r) => r.id));
}

/**
 * Waive `month` for the tenant: delete the late fees on it, keep their run
 * records, and leave a row that stops any more being planned. Doing it again
 * is harmless — it re-stamps who and when and removes anything that accrued
 * since an earlier un-waive. Returns null when the user can't reach the tenant.
 */
export async function waiveLateFee(opts: {
  userId: string;
  tenantId: string;
  month: string;
  note?: string;
  now?: Date;
}): Promise<WaiverDTO | null> {
  const { userId, tenantId, month, now = new Date() } = opts;
  if (!(await requireTenant(userId, tenantId))) return null;
  const who = await nameOf(userId);
  const lateRuleIds = await lateRuleIdsOf(tenantId);
  const charges = await prisma.tenantCharge.findMany({
    where: { tenantId, month },
    select: { id: true, month: true, kind: true, ruleId: true },
  });
  const remove = chargesToRemove(charges, lateRuleIds, month);
  const data = {
    waivedById: userId,
    waivedByName: who,
    waivedAt: now,
    note: opts.note?.trim().slice(0, 200) || null,
    unwaivedAt: null,
    unwaivedById: null,
    unwaivedByName: "",
  };
  // The row first, in the same transaction as the deletes: a statement load
  // racing this either sees the old fees (and the row, a moment later) or
  // sees the row and plans nothing — never the fees gone and no row.
  const [row] = await prisma.$transaction([
    prisma.lateFeeWaiver.upsert({
      where: { tenantId_month: { tenantId, month } },
      create: { tenantId, month, ...data },
      update: data,
    }),
    prisma.tenantCharge.deleteMany({ where: { id: { in: remove } } }),
  ]);
  return waiverDTO(row);
}

/**
 * Take the waiver back: late fees for the month start again today (see
 * lib/late-fee-waiver.ts). The row stays, stamped, because that day is what
 * stops the waived days being billed. Null when the user can't reach the
 * tenant; a month that isn't waived is left as it is.
 */
export async function unwaiveLateFee(opts: {
  userId: string;
  tenantId: string;
  month: string;
  now?: Date;
}): Promise<WaiverDTO | null | "not-waived"> {
  const { userId, tenantId, month, now = new Date() } = opts;
  if (!(await requireTenant(userId, tenantId))) return null;
  const existing = await prisma.lateFeeWaiver.findUnique({ where: { tenantId_month: { tenantId, month } } });
  if (!existing || existing.unwaivedAt) return "not-waived";
  const who = await nameOf(userId);
  const lateRuleIds = await lateRuleIdsOf(tenantId);
  const runs = await prisma.tenantRuleRun.findMany({
    where: { month, rule: { tenantId } },
    select: { id: true, ruleId: true, month: true, day: true },
  });
  const clear = runsToClear(runs, lateRuleIds, month).map((r) => r.id);
  const [row] = await prisma.$transaction([
    prisma.lateFeeWaiver.update({
      where: { id: existing.id },
      data: { unwaivedAt: now, unwaivedById: userId, unwaivedByName: who },
    }),
    prisma.tenantRuleRun.deleteMany({ where: { id: { in: clear } } }),
  ]);
  return waiverDTO(row);
}

/**
 * The one current tenant a rent entry for this property (and unit) belongs
 * to — the same match the statement uses. None, or two sharing the place
 * without units, means there is no one tenant to waive for.
 */
export async function tenantForRentTarget(propertyId: string, unitId: string | null) {
  // On a one-unit property the whole property is that unit (lib/rent-target),
  // so rent logged on either finds the tenant on either.
  const units = await prisma.unit.findMany({ where: { propertyId }, select: { id: true } });
  const tenants = await prisma.tenant.findMany({
    where: { propertyId, active: true, OR: unitIdsCountingToward(unitId, units).map((u) => ({ unitId: u })) },
    select: { id: true, name: true },
    take: 2,
  });
  return tenants.length === 1 ? tenants[0] : null;
}

/**
 * The "Waive late fee for this month" box on a rent entry, ticked (true) or
 * unticked (false) — absent means leave the month as it is. The month is the
 * entry's date's; the tenant is the one current tenant of its place.
 * Ticked with no one tenant there is an error the form reports; unticked with
 * nothing waived is a no-op.
 */
export async function waiverFromRentEntry(opts: {
  userId: string;
  propertyId: string;
  unitId: string | null;
  date: Date;
  waive: boolean;
}): Promise<{ error: string } | { waiver: WaiverDTO | null }> {
  const month = opts.date.toISOString().slice(0, 7);
  const tenant = await tenantForRentTarget(opts.propertyId, opts.unitId);
  if (!tenant) {
    return opts.waive
      ? { error: "There's no one current tenant here to waive a late fee for." }
      : { waiver: null };
  }
  if (opts.waive) {
    const w = await waiveLateFee({ userId: opts.userId, tenantId: tenant.id, month });
    return w ? { waiver: w } : { error: "Not found" };
  }
  const w = await unwaiveLateFee({ userId: opts.userId, tenantId: tenant.id, month });
  return w === null ? { error: "Not found" } : { waiver: w === "not-waived" ? null : w };
}

/** "tenantId|YYYY-MM" → true for every month waived, across these LLCs. */
export async function waivedLateFeesFor(companyIds: string[]): Promise<Record<string, true>> {
  const rows = await prisma.lateFeeWaiver.findMany({
    where: { unwaivedAt: null, tenant: { active: true, property: { companyId: { in: companyIds } } } },
    select: { tenantId: true, month: true, waivedAt: true, unwaivedAt: true },
  });
  return waivedKeys(rows);
}
