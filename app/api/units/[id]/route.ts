import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireUnit } from "@/lib/access";
import { monthKeyOf, recordRentChange } from "@/lib/rent";
import { validRent } from "@/lib/money";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await requireUnit(userId, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data: { name?: string; monthlyRent?: number; vacant?: boolean } = {};

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Unit name is required." }, { status: 400 });
    data.name = name;
  }
  if (body?.monthlyRent !== undefined) {
    const rent = Number(body.monthlyRent);
    if (!validRent(rent)) {
      return NextResponse.json({ error: "Enter a valid monthly rent." }, { status: 400 });
    }
    data.monthlyRent = rent;
  }
  if (body?.vacant !== undefined) {
    data.vacant = Boolean(body.vacant);
  }

  const unit = await prisma.$transaction(async (tx) => {
    if (data.monthlyRent !== undefined) {
      await recordRentChange(tx, {
        propertyId: existing.propertyId,
        unitId: id,
        from: existing.monthlyRent,
        to: data.monthlyRent,
        month: monthKeyOf(new Date()),
        userId,
      });
    }
    return tx.unit.update({ where: { id }, data });
  });
  const rentChanges = await prisma.rentChange.findMany({
    where: { propertyId: existing.propertyId, unitId: id },
    orderBy: { effectiveFrom: "asc" },
  });

  return NextResponse.json({
    ...unit,
    rentChanges: rentChanges.map((c) => ({
      id: c.id,
      propertyId: c.propertyId,
      unitId: c.unitId,
      effectiveFrom: monthKeyOf(c.effectiveFrom),
      amount: c.amount,
    })),
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireUnit(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Cascades to the unit's tenants and rent history.
  if (!(await requireUnit(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner of this LLC can remove a unit." }, { status: 403 });
  }

  await prisma.unit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
