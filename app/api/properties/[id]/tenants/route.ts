import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { clampDueDay, parseDay, serializeTenant, text } from "@/lib/tenants";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenants = await prisma.tenant.findMany({
    where: { propertyId: id },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(tenants.map(serializeTenant));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const name = text(body?.name, 120);
  if (!name) return NextResponse.json({ error: "A tenant name is required." }, { status: 400 });

  // A unit can only be named if it belongs to this property — otherwise the
  // tenant would show up under someone else's house.
  let unitId: string | null = null;
  if (typeof body?.unitId === "string" && body.unitId) {
    const unit = await prisma.unit.findUnique({ where: { id: body.unitId } });
    if (!unit || unit.propertyId !== id) {
      return NextResponse.json({ error: "That unit isn't part of this property." }, { status: 400 });
    }
    unitId = unit.id;
  }

  const tenant = await prisma.tenant.create({
    data: {
      propertyId: id,
      unitId,
      createdById: userId,
      name,
      email: text(body?.email, 200),
      phone: text(body?.phone, 40),
      leaseStart: parseDay(body?.leaseStart),
      leaseEnd: parseDay(body?.leaseEnd),
      deposit: Math.max(0, Number(body?.deposit) || 0),
      dueDay: clampDueDay(body?.dueDay),
      note: text(body?.note, 500),
    },
  });

  return NextResponse.json(serializeTenant(tenant), { status: 201 });
}
