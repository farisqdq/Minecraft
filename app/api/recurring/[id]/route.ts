import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireRecurring } from "@/lib/access";
import { normalizeCategory } from "@/lib/categories";
import { validAmount } from "@/lib/money";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireRecurring(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data: Record<string, unknown> = {};

  if (body?.active !== undefined) data.active = Boolean(body.active);
  if (body?.amount !== undefined) {
    const amount = Number(body.amount);
    if (!validAmount(amount)) return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
    data.amount = amount;
  }
  if (body?.category !== undefined) {
    const category = normalizeCategory(body.category);
    if (!category) return NextResponse.json({ error: "Pick a category." }, { status: 400 });
    data.category = category;
  }
  if (body?.detail !== undefined) data.detail = String(body.detail).trim() || null;
  if (body?.note !== undefined) data.note = String(body.note).trim() || null;
  if (body?.day !== undefined) data.day = Math.min(31, Math.max(1, Math.round(Number(body.day)) || 1));
  if (body?.frequency !== undefined) data.frequency = body.frequency === "yearly" ? "yearly" : "monthly";
  if (body?.month !== undefined) {
    data.month = body.month === null ? null : Math.min(12, Math.max(1, Math.round(Number(body.month)) || 1));
  }

  const template = await prisma.recurringExpense.update({ where: { id }, data });
  return NextResponse.json(template);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireRecurring(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.recurringExpense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
