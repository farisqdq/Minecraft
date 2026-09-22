import { redirect, notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount, requestInclude, serializeRequestForLandlord } from "@/lib/requests";
import { isOpen } from "@/lib/maintenance";
import { balancesForTenants } from "@/lib/statements";
import { requireProperty } from "@/lib/access";
import { serializeTenant } from "@/lib/tenants";
import { isoDay } from "@/lib/lease";
import { monthKeyOf } from "@/lib/rent";
import PropertyManageClient from "./PropertyManageClient";

// Enough to see the shape of a place's troubles without turning the page
// into a second copy of the Repairs queue.
const PROPERTY_REQUEST_LIMIT = 12;

export default async function PropertyManagePage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const openRepairs = await openRepairCount(userId);

  const { id } = await params;

  const property = await requireProperty(userId, id);
  if (!property) notFound();

  const membership = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: property.companyId, userId } },
    select: { role: true },
  });

  const [company, units, recurring, tenants, rentChanges, transactions, requests] = await Promise.all([
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
    prisma.maintenanceRequest.findMany({
      where: { propertyId: id },
      include: requestInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const balances = await balancesForTenants(tenants.map((t) => t.id));

  return (
    <PropertyManageClient
      openRepairs={openRepairs}
      companyName={company?.name ?? ""}
      canManage={membership?.role === "owner"}
      serverToday={isoDay(new Date())}
      serverNow={new Date().toISOString()}
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
      initialBalances={balances}
      initialRequests={requests
        .map(serializeRequestForLandlord)
        // Anything still open comes first — a finished urgent repair from
        // March must not sit above a leak reported this morning — then
        // urgent before normal, then newest. Sorted here rather than in the
        // query because "open" is three statuses, not a column.
        .sort(
          (a, b) =>
            Number(isOpen(b.status)) - Number(isOpen(a.status)) ||
            Number(b.urgency === "urgent") - Number(a.urgency === "urgent") ||
            b.createdAt.localeCompare(a.createdAt)
        )
        .slice(0, PROPERTY_REQUEST_LIMIT)}
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
