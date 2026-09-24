import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { monthKeyOf, recordRentChange } from "@/lib/rent";
import { validRent } from "@/lib/money";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await requireProperty(userId, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const monthlyRent = Number(body?.monthlyRent);

  if (!name) {
    return NextResponse.json({ error: "Property name is required." }, { status: 400 });
  }
  if (!validRent(monthlyRent)) {
    return NextResponse.json({ error: "Enter a valid monthly rent." }, { status: 400 });
  }

  const data: { name: string; address: string | null; monthlyRent: number; vacant?: boolean } = {
    name,
    address: address || null,
    monthlyRent,
  };
  if (body?.vacant !== undefined) data.vacant = Boolean(body.vacant);

  // The rent change and the property update land together, so the books can
  // never show a new rent with no record of when it started.
  const property = await prisma.$transaction(async (tx) => {
    await recordRentChange(tx, {
      propertyId: id,
      unitId: null,
      from: existing.monthlyRent,
      to: monthlyRent,
      month: monthKeyOf(new Date()),
      userId,
    });
    return tx.property.update({ where: { id }, data });
  });
  // The client judges past months against this history, so hand back what
  // now applies rather than leaving it working from a pre-edit copy.
  const rentChanges = await prisma.rentChange.findMany({
    where: { propertyId: id, unitId: null },
    orderBy: { effectiveFrom: "asc" },
  });

  return NextResponse.json({
    ...property,
    address: property.address ?? "",
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
  // Two checks, so "there is no such property" and "you may not delete this
  // one" don't come back as the same answer.
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Removing a property takes its whole ledger, units, tenants, recurring
  // bills and rent history with it. That is not "record rent and expenses".
  if (!(await requireProperty(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner of this LLC can remove a property." }, { status: 403 });
  }

  await prisma.property.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
