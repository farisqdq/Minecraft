import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser, requireProperty, requireUnit } from "@/lib/access";
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

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyIds = await companyIdsForUser(userId);
  const transactions = await prisma.transaction.findMany({
    where: { property: { companyId: { in: companyIds } } },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transactions.map(serialize));
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
  const unitId = typeof body?.unitId === "string" && body.unitId ? body.unitId : null;
  const type = body?.type === "expense" ? "expense" : "rent";
  const date = typeof body?.date === "string" ? new Date(body.date) : null;
  const amount = Number(body?.amount);
  const detail = typeof body?.detail === "string" ? body.detail.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const category = type === "expense" ? normalizeCategory(body?.category) : null;

  if (!propertyId || !date || isNaN(date.getTime()) || !(amount > 0)) {
    return NextResponse.json({ error: "Missing or invalid fields." }, { status: 400 });
  }
  if (type === "expense" && !category) {
    return NextResponse.json({ error: "Pick a category for this expense." }, { status: 400 });
  }

  if (!(await requireProperty(userId, propertyId))) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }
  if (unitId) {
    const unit = await requireUnit(userId, unitId);
    if (!unit || unit.propertyId !== propertyId) {
      return NextResponse.json({ error: "That unit doesn't belong to this property." }, { status: 400 });
    }
  }

  const transaction = await prisma.transaction.create({
    data: {
      propertyId,
      unitId,
      createdById: userId,
      type,
      date,
      amount,
      detail: detail || null,
      note: note || null,
      category,
    },
  });
  return NextResponse.json(serialize(transaction), { status: 201 });
}
