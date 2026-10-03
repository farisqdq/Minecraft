import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { serializeRentChange } from "@/lib/rent";
import { undoRenewal } from "@/lib/renewals-db";
import { serializeTenant } from "@/lib/tenants";

/** Undo: the lease end and rent go back to what they were before the renewal. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const renewal = await prisma.leaseRenewal.findUnique({ where: { id }, select: { tenantId: true } });
  const tenant = renewal ? await requireTenant(userId, renewal.tenantId) : null;
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await undoRenewal(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });

  const [fresh, rentChanges] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenant.id } }),
    prisma.rentChange.findMany({
      where: { propertyId: tenant.propertyId, unitId: tenant.unitId },
      orderBy: { effectiveFrom: "asc" },
    }),
  ]);
  return NextResponse.json({ tenant: fresh ? serializeTenant(fresh) : null, rentChanges: rentChanges.map(serializeRentChange) });
}
