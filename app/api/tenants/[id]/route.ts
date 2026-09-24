import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany, requireTenant } from "@/lib/access";
import { clampDueDay, parseDay, serializeTenant, text } from "@/lib/tenants";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await requireTenant(userId, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if ("name" in body) {
    const name = text(body.name, 120);
    if (!name) return NextResponse.json({ error: "A tenant name is required." }, { status: 400 });
    data.name = name;
  }
  if ("email" in body) data.email = text(body.email, 200);
  if ("phone" in body) data.phone = text(body.phone, 40);
  if ("note" in body) data.note = text(body.note, 500);
  if ("leaseStart" in body) data.leaseStart = parseDay(body.leaseStart);
  if ("leaseEnd" in body) data.leaseEnd = parseDay(body.leaseEnd);
  if ("deposit" in body) data.deposit = Math.max(0, Number(body.deposit) || 0);
  if ("dueDay" in body) data.dueDay = clampDueDay(body.dueDay);
  if ("active" in body) data.active = body.active !== false;

  if ("unitId" in body) {
    const raw = body.unitId;
    if (typeof raw === "string" && raw) {
      const unit = await prisma.unit.findUnique({ where: { id: raw } });
      if (!unit || unit.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "That unit isn't part of this property." }, { status: 400 });
      }
      data.unitId = unit.id;
    } else {
      data.unitId = null;
    }
  }

  const tenant = await prisma.tenant.update({ where: { id }, data });
  return NextResponse.json(serializeTenant(tenant));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tenant = await requireTenant(userId, id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Takes their charges, billing rules and notices with them, so it's an
  // owner's call — the same bar as deleting a unit or a property. A member
  // can still mark someone moved out, which keeps the history.
  if (!(await requireCompany(userId, tenant.property.companyId, "owner"))) {
    return NextResponse.json(
      { error: "Only an owner can delete a tenant. Mark them moved out instead." },
      { status: 403 }
    );
  }

  await prisma.tenant.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
