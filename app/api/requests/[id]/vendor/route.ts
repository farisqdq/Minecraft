import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requestForUser, requestInclude, serializeRequestForLandlord } from "@/lib/requests";

/**
 * Put someone on a repair, or take them off it (`vendorId: null`).
 *
 * The tenant is not told who. The thread is theirs to read, and a vendor's
 * name and number in it would be the vendor's contact details handed out to
 * everyone who has ever reported a leak.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await requestForUser(me.id, id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const vendorId = typeof body?.vendorId === "string" && body.vendorId ? body.vendorId : null;

  if (vendorId) {
    // Same LLC as the property, not merely an LLC you're on. Otherwise a
    // teammate on two companies could file one company's repair against the
    // other's contractor, and its cost would land in the wrong vendor total.
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.companyId !== request.property.companyId) {
      return NextResponse.json({ error: "That vendor isn't in this LLC's book." }, { status: 400 });
    }
  }

  await prisma.maintenanceRequest.update({ where: { id }, data: { vendorId } });
  const fresh = await prisma.maintenanceRequest.findUnique({ where: { id }, include: requestInclude });
  return NextResponse.json(serializeRequestForLandlord(fresh!));
}
