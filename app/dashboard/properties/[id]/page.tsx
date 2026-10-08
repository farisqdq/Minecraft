import { redirect, notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount, requestInclude, serializeRequestForLandlord } from "@/lib/requests";
import { isOpen } from "@/lib/maintenance";
import { balancesForTenants } from "@/lib/statements";
import { hasRole, requireProperty } from "@/lib/access";
import { serializeTenant } from "@/lib/tenants";
import { unreadByTenantForProperty } from "@/lib/messages-db";
import { isoDay } from "@/lib/lease";
import { serializeRentChange } from "@/lib/rent";
import { applyDueRentChanges, serializeRenewal } from "@/lib/renewals-db";
import { listingsWhere } from "@/lib/listings-db";
import { documentsWhere } from "@/lib/documents-db";
import { blobConfigured } from "@/lib/blob";
import { fileLink } from "@/lib/file-links";
import { loansWhere } from "@/lib/loans-db";
import { moveOutInclude, serializeMoveOut } from "@/lib/move-outs-db";
import { serializeAsset } from "@/lib/assets-db";
import PropertyManageClient from "./PropertyManageClient";

// Enough to see the shape of a place's troubles without turning the page
// into a second copy of the Repairs queue.
const PROPERTY_REQUEST_LIMIT = 12;

export default async function PropertyManagePage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const openRepairs = await openRepairCount(userId);

  const { id } = await params;

  const found = await requireProperty(userId, id, "viewer");
  if (!found) notFound();
  // A raise renewed ahead of time becomes today's rent in its month (a25).
  const property =
    (await applyDueRentChanges({ propertyId: id })) > 0
      ? ((await prisma.property.findUnique({ where: { id } })) ?? found)
      : found;

  const membership = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: property.companyId, userId } },
    select: { role: true },
  });
  const canWrite = hasRole(membership?.role, "member");

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
  // The property's own documents and its tenants' — both carry its id.
  const documents = await documentsWhere({ propertyId: property.id });
  const loans = await loansWhere({ propertyId: property.id });
  const assets = await prisma.depreciableAsset.findMany({
    where: { propertyId: property.id },
    orderBy: { createdAt: "asc" },
  });
  const moveOuts = await prisma.moveOut.findMany({
    where: { tenant: { propertyId: property.id } },
    include: moveOutInclude,
  });
  // For the "Messages (n unread)" link on each tenant's card.
  const unreadMessages = await unreadByTenantForProperty(property.id);
  // Listings for this property's empty places (a27).
  const listings = await listingsWhere({ propertyId: property.id });
  // Each tenant's latest renewal (a25), for the line on their card.
  const renewals = await prisma.leaseRenewal.findMany({
    where: { tenant: { propertyId: property.id } },
    orderBy: { createdAt: "asc" },
  });

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
        vacantSince: property.vacantSince ? property.vacantSince.toISOString().slice(0, 10) : null,
      }}
      initialUnits={units.map((u) => ({
        id: u.id,
        propertyId: u.propertyId,
        name: u.name,
        monthlyRent: u.monthlyRent,
        vacant: u.vacant,
        vacantSince: u.vacantSince ? u.vacantSince.toISOString().slice(0, 10) : null,
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
      initialDocuments={documents}
      initialLoans={loans}
      initialAssets={assets.map(serializeAsset)}
      initialMoveOuts={Object.fromEntries(moveOuts.map((m) => [m.tenantId, serializeMoveOut(m)]))}
      unreadMessages={unreadMessages}
      storageReady={blobConfigured()}
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
            // An open invite code is a way in (whoever redeems it becomes the
            // tenant's portal login), so a viewer isn't handed one.
            inviteCode: canWrite ? (t.invites[0]?.code ?? "") : "",
            inviteExpires: canWrite ? (t.invites[0]?.expiresAt.toISOString() ?? "") : "",
            accountEmail: t.account?.email ?? "",
            accountSince: t.account?.createdAt.toISOString() ?? "",
            lastLoginAt: t.account?.lastLoginAt?.toISOString() ?? "",
          },
        ])
      )}
      rentChanges={rentChanges.map(serializeRentChange)}
      initialRenewals={Object.fromEntries(renewals.map((r) => [r.tenantId, serializeRenewal(r)]))}
      initialListings={listings}
      transactions={transactions.map((t) => ({
        id: t.id,
        unitId: t.unitId,
        type: t.type as "rent" | "expense",
        date: t.date.toISOString().slice(0, 10),
        amount: t.amount,
        detail: t.detail ?? "",
        note: t.note ?? "",
        category: t.category ?? "",
        appliesTo: t.appliesTo,
        // Thumbnails and the paperclip on "Recent activity" read these;
        // files are only ever served through /api/files (access-checked).
        attachments: t.attachments.map((a) => ({
          id: a.id,
          transactionId: t.id,
          url: fileLink("attachment", a.id),
          filename: a.filename,
          contentType: a.contentType,
        })),
        loanPaymentId: t.loanPaymentId,
      }))}
    />
  );
}
