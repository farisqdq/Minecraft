import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty, requireUnit } from "@/lib/access";
import { validAmount } from "@/lib/money";
import { tenantForRentTarget, waiveLateFee } from "@/lib/late-fee-waivers-db";
import { freeRentLabel } from "@/lib/free-rent";

/**
 * A free month (a35), from the record-payment form: rent for one month that
 * the tenant was given rather than paid. It goes on their statement as a
 * credit for that month (marked freeRent), and the month's late fees are
 * waived, so the month is square everywhere rent is checked — while nothing
 * is added to the ledger, so it never counts as money in.
 *
 * Undo it from the tenant's statement like any other credit.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
  const unitId = typeof body?.unitId === "string" && body.unitId ? body.unitId : null;
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  const amount = Math.round((Number(body?.amount) || 0) * 100) / 100;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 100) : "";

  if (!propertyId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "Pick the month that was free." }, { status: 400 });
  }
  if (!validAmount(amount)) return NextResponse.json({ error: "Enter the rent that was given free." }, { status: 400 });
  if (!(await requireProperty(userId, propertyId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (unitId) {
    const unit = await requireUnit(userId, unitId);
    if (!unit || unit.propertyId !== propertyId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await tenantForRentTarget(propertyId, unitId);
  if (!tenant) {
    return NextResponse.json(
      { error: "A free month goes on one tenant's account, and this place doesn't have exactly one current tenant." },
      { status: 400 },
    );
  }
  const already = await prisma.tenantCharge.findFirst({ where: { tenantId: tenant.id, month, freeRent: true }, select: { id: true } });
  if (already) {
    return NextResponse.json({ error: `${tenant.name} already has that month free. Remove it from their statement first to change it.` }, { status: 409 });
  }

  const charge = await prisma.tenantCharge.create({
    data: { tenantId: tenant.id, kind: "credit", month, label: freeRentLabel(reason), amount, raisedById: userId, freeRent: true },
  });
  // No late fee for a month that was given free.
  await waiveLateFee({ userId, tenantId: tenant.id, month, note: "Free month" });

  return NextResponse.json({ id: charge.id, tenantId: tenant.id, tenantName: tenant.name, month, amount }, { status: 201 });
}
