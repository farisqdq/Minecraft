import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount, requestInclude, serializeRequest } from "@/lib/requests";
import { blobConfigured } from "@/lib/blob";
import { serializeTenant } from "@/lib/tenants";
import { isoDay } from "@/lib/lease";
import { monthKeyOf } from "@/lib/rent";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const userId = me.id;
  const openRepairs = await openRepairCount(userId);

  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);

  const [properties, units, recurring, rentChanges, tenants, transactions, openRequests] = await Promise.all([
    prisma.property.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.unit.findMany({
      where: { property: { companyId: { in: companyIds } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.recurringExpense.findMany({
      where: { property: { companyId: { in: companyIds } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.rentChange.findMany({
      where: { property: { companyId: { in: companyIds } } },
      orderBy: { effectiveFrom: "asc" },
    }),
    prisma.tenant.findMany({
      where: { property: { companyId: { in: companyIds } }, active: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transaction.findMany({
      where: { property: { companyId: { in: companyIds } } },
      orderBy: { date: "desc" },
      include: { attachments: { orderBy: { createdAt: "asc" } } },
    }),
    // What tenants are waiting on. Urgent first, then oldest, matching the
    // Repairs queue so the two never disagree about what's most pressing.
    prisma.maintenanceRequest.findMany({
      where: {
        property: { companyId: { in: companyIds } },
        status: { in: ["open", "seen", "scheduled"] },
      },
      include: requestInclude,
      orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  return (
    <DashboardClient
      openRepairs={openRepairs}
      initialRepairs={openRequests.map(serializeRequest)}
      userLabel={me.name || me.email || "you"}
      storageReady={blobConfigured()}
      serverToday={isoDay(new Date())}
      initialCompanies={memberships.map((m) => ({
        id: m.company.id,
        name: m.company.name,
        role: m.role as "owner" | "member",
      }))}
      initialProperties={properties.map((p) => ({
        id: p.id,
        companyId: p.companyId,
        name: p.name,
        address: p.address ?? "",
        monthlyRent: p.monthlyRent,
        vacant: p.vacant,
      }))}
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
      initialRentChanges={rentChanges.map((c) => ({
        id: c.id,
        propertyId: c.propertyId,
        unitId: c.unitId,
        effectiveFrom: monthKeyOf(c.effectiveFrom),
        amount: c.amount,
      }))}
      initialTenants={tenants.map(serializeTenant)}
      initialTransactions={transactions.map((t) => ({
        id: t.id,
        propertyId: t.propertyId,
        unitId: t.unitId,
        type: t.type as "rent" | "expense",
        date: t.date.toISOString().slice(0, 10),
        amount: t.amount,
        detail: t.detail ?? "",
        note: t.note ?? "",
        category: t.category ?? "",
        recurringExpenseId: t.recurringExpenseId,
        attachments: t.attachments.map((a) => ({
          id: a.id,
          transactionId: a.transactionId,
          url: a.url,
          filename: a.filename,
          contentType: a.contentType,
        })),
      }))}
    />
  );
}
