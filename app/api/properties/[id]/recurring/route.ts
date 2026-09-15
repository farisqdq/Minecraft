import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty, requireUnit } from "@/lib/access";
import { normalizeCategory } from "@/lib/categories";

function clampDay(day: number) {
  return Math.min(31, Math.max(1, Math.round(day) || 1));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const templates = await prisma.recurringExpense.findMany({
    where: { propertyId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(templates);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const category = normalizeCategory(body?.category);
  const detail = typeof body?.detail === "string" ? body.detail.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const amount = Number(body?.amount);
  const frequency = body?.frequency === "yearly" ? "yearly" : "monthly";
  const day = clampDay(Number(body?.day));
  const month = frequency === "yearly" ? Math.min(12, Math.max(1, Math.round(Number(body?.month)) || 1)) : null;
  const unitId = typeof body?.unitId === "string" && body.unitId ? body.unitId : null;

  if (!category) {
    return NextResponse.json({ error: "Pick a category." }, { status: 400 });
  }
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
  }
  if (unitId) {
    const unit = await requireUnit(userId, unitId);
    if (!unit || unit.propertyId !== id) {
      return NextResponse.json({ error: "That unit doesn't belong to this property." }, { status: 400 });
    }
  }

  const template = await prisma.recurringExpense.create({
    data: {
      propertyId: id,
      unitId,
      category,
      detail: detail || null,
      note: note || null,
      amount,
      frequency,
      day,
      month,
      createdById: userId,
    },
  });
  return NextResponse.json(template, { status: 201 });
}
