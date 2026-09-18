import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { blobConfigured } from "@/lib/blob";
import { serializeTenant } from "@/lib/tenants";
import { isoDay } from "@/lib/lease";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id as string;

  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);

  const [properties, units, recurring, tenants, transactions] = await Promise.all([
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
    prisma.tenant.findMany({
      where: { property: { companyId: { in: companyIds } }, active: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transaction.findMany({
      where: { property: { companyId: { in: companyIds } } },
      orderBy: { date: "desc" },
      include: { attachments: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  return (
    <DashboardClient
      userLabel={session.user.name || session.user.email || "you"}
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
