import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireProperty } from "@/lib/access";
import PropertyManageClient from "./PropertyManageClient";

export default async function PropertyManagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const userId = session.user.id as string;

  const property = await requireProperty(userId, id);
  if (!property) notFound();

  const [units, recurring] = await Promise.all([
    prisma.unit.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } }),
    prisma.recurringExpense.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <PropertyManageClient
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
    />
  );
}
