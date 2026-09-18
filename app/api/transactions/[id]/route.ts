import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty, requireUnit } from "@/lib/access";
import { normalizeCategory } from "@/lib/categories";

function serialize<T extends { date: Date; detail: string | null; note: string | null; category: string | null }>(
  t: T
) {
  return {
    ...t,
    date: t.date.toISOString().slice(0, 10),
    detail: t.detail ?? "",
    note: t.note ?? "",
    category: t.category ?? "",
  };
}

/**
 * Corrects an entry in place. Fixing a mistyped amount used to mean deleting
 * the row and re-adding it, which threw away the receipt attached to it —
 * exactly the proof you would want to keep.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing || !(await requireProperty(userId, existing.propertyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const type = body.type === "expense" ? "expense" : body.type === "rent" ? "rent" : existing.type;
  const propertyId = typeof body.propertyId === "string" && body.propertyId ? body.propertyId : existing.propertyId;
  const unitId =
    "unitId" in body ? (typeof body.unitId === "string" && body.unitId ? body.unitId : null) : existing.unitId;
  const date = typeof body.date === "string" ? new Date(body.date) : existing.date;
  const amount = "amount" in body ? Number(body.amount) : existing.amount;
  const category = type === "expense" ? normalizeCategory(body.category ?? existing.category) : null;

  if (!date || isNaN(date.getTime()) || !(amount > 0)) {
    return NextResponse.json({ error: "Missing or invalid fields." }, { status: 400 });
  }
  if (type === "expense" && !category) {
    return NextResponse.json({ error: "Pick a category for this expense." }, { status: 400 });
  }

  // Moving an entry to another property is only allowed between properties
  // the user can already reach, and a unit has to belong to its property.
  if (propertyId !== existing.propertyId && !(await requireProperty(userId, propertyId))) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }
  if (unitId) {
    const unit = await requireUnit(userId, unitId);
    if (!unit || unit.propertyId !== propertyId) {
      return NextResponse.json({ error: "That unit doesn't belong to this property." }, { status: 400 });
    }
  }

  const transaction = await prisma.transaction.update({
    where: { id },
    data: {
      propertyId,
      unitId,
      type,
      date,
      amount,
      detail: typeof body.detail === "string" ? body.detail.trim() || null : existing.detail,
      note: typeof body.note === "string" ? body.note.trim() || null : existing.note,
      category,
    },
    include: { attachments: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json(serialize(transaction));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction || !(await requireProperty(userId, transaction.propertyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.transaction.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
