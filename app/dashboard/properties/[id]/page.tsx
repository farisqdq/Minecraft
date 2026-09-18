import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireProperty } from "@/lib/access";
import { serializeTenant } from "@/lib/tenants";
import { isoDay } from "@/lib/lease";
import PropertyManageClient from "./PropertyManageClient";

export default async function PropertyManagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const userId = session.user.id as string;

  const property = await requireProperty(userId, id);
  if (!property) notFound();

  const [company, units, recurring, tenants, transactions] = await Promise.all([
    prisma.company.findUnique({ where: { id: property.companyId }, select: { name: true } }),
    prisma.unit.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } }),
    prisma.recurringExpense.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } }),
    prisma.tenant.findMany({
      where: { propertyId: id },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
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
