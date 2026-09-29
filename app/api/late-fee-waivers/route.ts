import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty, requireUnit } from "@/lib/access";
import { waiverMonth } from "@/lib/late-fee-waiver";
import { tenantForRentTarget, waiverDTO } from "@/lib/late-fee-waivers-db";

/**
 * GET ?propertyId=&unitId=&month=YYYY-MM — for the "Waive late fee for this
 * month" box on a rent form: whose rent this is (the one current tenant of
 * that place, or null, and then the box isn't shown) and whether that month
 * is already waived.
 */
export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const propertyId = q.get("propertyId") ?? "";
  const unitId = q.get("unitId") || null;
  const month = waiverMonth(q.get("month"));
  if (!propertyId || !month) return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  if (!(await requireProperty(userId, propertyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (unitId) {
    const unit = await requireUnit(userId, unitId);
    if (!unit || unit.propertyId !== propertyId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await tenantForRentTarget(propertyId, unitId);
  const row = tenant
    ? await prisma.lateFeeWaiver.findUnique({ where: { tenantId_month: { tenantId: tenant.id, month } } })
    : null;
  return NextResponse.json({ tenant, month, waiver: row ? waiverDTO(row) : null });
}
