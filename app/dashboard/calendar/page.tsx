import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount } from "@/lib/requests";
import { isoDay } from "@/lib/lease";
import { monthKeyOf } from "@/lib/rent";
import { applyDueRentChanges } from "@/lib/renewals-db";
import { blobConfigured } from "@/lib/blob";
import CalendarClient from "./CalendarClient";

export default async function CalendarPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const memberships = await prisma.companyMember.findMany({
    where: { userId: me.id },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);
  const scope = { property: { companyId: { in: companyIds } } };
  // A raise renewed ahead of time becomes today's rent in its month (a25).
  await applyDueRentChanges(scope);

  const [properties, units, rentChanges, tenants, payments, rules, openRepairs] = await Promise.all([
    prisma.property.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true, name: true, companyId: true, monthlyRent: true, vacant: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.unit.findMany({
      where: scope,
      select: { id: true, propertyId: true, name: true, monthlyRent: true, vacant: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentChange.findMany({ where: scope, orderBy: { effectiveFrom: "asc" } }),
    prisma.tenant.findMany({
      where: { ...scope, active: true },
      select: { id: true, name: true, propertyId: true, unitId: true, dueDay: true, phone: true },
    }),
    // Rent only: the calendar is about money coming in. Two years either side
    // of today is more than anyone pages through, and keeps this bounded.
    prisma.transaction.findMany({
      where: {
        ...scope,
        type: "rent",
        date: { gte: new Date(Date.now() - 2 * 365 * 86_400_000), lte: new Date(Date.now() + 2 * 365 * 86_400_000) },
      },
      select: { propertyId: true, unitId: true, date: true, amount: true, appliesTo: true },
    }),
    prisma.tenantChargeRule.findMany({
      where: { kind: "monthly", active: true, tenant: { ...scope, active: true } },
    }),
    openRepairCount(me.id),
  ]);

  // Late fees on the books per tenant per month, as the overview has them,
  // so "Mark paid" here offers the same amount owed as Needs attention.
  const lateFeeRows = await prisma.tenantCharge.groupBy({
    by: ["tenantId", "month"],
    where: {
      kind: "fee",
      rule: { kind: "late" },
      tenant: { active: true, property: { companyId: { in: companyIds } } },
    },
    _sum: { amount: true },
  });
  const lateFees: Record<string, number> = {};
  for (const r of lateFeeRows) lateFees[`${r.tenantId}|${r.month}`] = Math.round((r._sum.amount ?? 0) * 100) / 100;

  return (
    <CalendarClient
      lateFees={lateFees}
      storageReady={blobConfigured()}
      openRepairs={openRepairs}
      serverToday={isoDay(new Date())}
      companies={memberships.map((m) => m.company)}
      properties={properties}
      units={units}
      rentChanges={rentChanges.map((c) => ({
        id: c.id,
        propertyId: c.propertyId,
        unitId: c.unitId,
        effectiveFrom: monthKeyOf(c.effectiveFrom),
        amount: c.amount,
      }))}
      tenants={tenants.map((t) => ({ ...t, phone: t.phone ?? "" }))}
      payments={payments.map((p) => ({
        propertyId: p.propertyId,
        unitId: p.unitId,
        date: p.date.toISOString().slice(0, 10),
        amount: p.amount,
        appliesTo: p.appliesTo,
      }))}
      rules={rules.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        kind: "monthly" as const,
        label: r.label,
        amount: r.amount,
        percent: r.percent,
        graceDays: r.graceDays,
        startMonth: r.startMonth,
        endMonth: r.endMonth,
        active: r.active,
      }))}
    />
  );
}
