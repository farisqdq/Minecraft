import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole, requireInspection } from "@/lib/access";
import { openRepairCount } from "@/lib/requests";
import { blobConfigured } from "@/lib/blob";
import { isoDay } from "@/lib/lease";
import { loadInspection, moveInFor } from "@/lib/inspections-db";
import InspectionClient from "./InspectionClient";

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { id } = await params;

  const found = await requireInspection(me.id, id, "viewer");
  if (!found) notFound();
  const tenant = found.tenant;

  const [inspection, membership, unit, account, openRepairs] = await Promise.all([
    loadInspection(id),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId: tenant.property.companyId, userId: me.id } },
      select: { role: true },
    }),
    tenant.unitId ? prisma.unit.findUnique({ where: { id: tenant.unitId }, select: { name: true } }) : null,
    prisma.tenantAccount.findUnique({ where: { tenantId: tenant.id }, select: { id: true } }),
    openRepairCount(me.id),
  ]);
  if (!inspection) notFound();
  // A move-out is read against the move-in; never against itself.
  const moveIn = inspection.kind === "move_out" ? await moveInFor(tenant.id) : null;

  return (
    <InspectionClient
      initial={inspection}
      moveIn={moveIn && moveIn.id !== inspection.id ? moveIn : null}
      tenantName={tenant.name}
      placeLabel={[tenant.property.name, unit?.name].filter(Boolean).join(", ")}
      propertyHref={`/dashboard/properties/${tenant.propertyId}#tenant-${tenant.id}`}
      hasPortal={Boolean(account)}
      canManage={hasRole(membership?.role, "owner")}
      storageReady={blobConfigured()}
      userLabel={me.name || me.email || "you"}
      openRepairs={openRepairs}
      today={isoDay(new Date())}
    />
  );
}
