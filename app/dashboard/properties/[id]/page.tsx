import { redirect, notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { requireProperty } from "@/lib/access";
import { serializeTenant } from "@/lib/tenants";
import { isoDay } from "@/lib/lease";
import { monthKeyOf } from "@/lib/rent";
import PropertyManageClient from "./PropertyManageClient";

export default async function PropertyManagePage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const { id } = await params;

  const property = await requireProperty(userId, id);
  if (!property) notFound();

  const membership = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: property.companyId, userId } },
    select: { role: true },
  });

  const [company, units, recurring, tenants, rentChanges, transactions] = await Promise.all([
    prisma.company.findUnique({ where: { id: property.companyId }, select: { name: true } }),
    prisma.unit.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } }),
    prisma.recurringExpense.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } }),
    prisma.tenant.findMany({
      where: { propertyId: id },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      include: {
        account: { select: { email: true, createdAt: true, lastLoginAt: true } },
        invites: {
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { code: true, expiresAt: true },
        },
      },
    }),
    prisma.rentChange.findMany({
      where: { propertyId: id },
      orderBy: { effectiveFrom: "asc" },
    }),
    prisma.transaction.findMany({
      where: { propertyId: id },
      orderBy: { date: "desc" },
      include: { attachments: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  return (
    <PropertyManageClient
      companyName={company?.name ?? ""}
      canManage={membership?.role === "owner"}
      serverToday={isoDay(new Date())}
      property={{
        id: property.id,
        name: property.name,
        address: property.address ?? "",
        monthlyRent: property.monthlyRent,
        vacant: property.vacant,
      }}
      initialUnits={units.map((u) => ({
        id: u.id,
        propertyId: u.propertyId,
        name: u.name,
        monthlyRent: u.monthlyRent,
        vacant: u.vacant,
      }))}
      initialRecurring={recurring.map((r) => ({
        id: r.id,
        propertyId: r.propertyId,
        unitId: r.unitId,
        category: r.category,
        detail: r.detail ?? "",
        note: r.note ?? "",
        amount: r.amount,
        frequency: r.frequency as "monthly" | "yearly",
        day: r.day,
        month: r.month,
        active: r.active,
      }))}
      initialTenants={tenants.map(serializeTenant)}
      initialPortal={Object.fromEntries(
        tenants.map((t) => [
          t.id,
          {
            inviteCode: t.invites[0]?.code ?? "",
            inviteExpires: t.invites[0]?.expiresAt.toISOString() ?? "",
            accountEmail: t.account?.email ?? "",
            accountSince: t.account?.createdAt.toISOString() ?? "",
            lastLoginAt: t.account?.lastLoginAt?.toISOString() ?? "",
          },
        ])
      )}
      rentChanges={rentChanges.map((c) => ({
        id: c.id,
        propertyId: c.propertyId,
        unitId: c.unitId,
        effectiveFrom: monthKeyOf(c.effectiveFrom),
        amount: c.amount,
      }))}
      transactions={transactions.map((t) => ({
        id: t.id,
        unitId: t.unitId,
        type: t.type as "rent" | "expense",
        date: t.date.toISOString().slice(0, 10),
        amount: t.amount,
        detail: t.detail ?? "",
        note: t.note ?? "",
        category: t.category ?? "",
        proofCount: t.attachments.length,
      }))}
    />
  );
}
