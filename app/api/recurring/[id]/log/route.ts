import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireRecurring } from "@/lib/access";

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate(); // month is 1-12 here
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const template = await requireRecurring(userId, id);
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const monthKey = typeof body?.month === "string" ? body.month : "";
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return NextResponse.json({ error: "Missing month." }, { status: 400 });
  const year = Number(match[1]);
  const month = Number(match[2]);

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const already = await prisma.transaction.findFirst({
    where: { recurringExpenseId: id, date: { gte: start, lt: end } },
  });
  if (already) {
    return NextResponse.json({ error: "Already logged for that month." }, { status: 409 });
  }

  const day = Math.min(template.day, daysInMonth(year, month));
  const date = new Date(Date.UTC(year, month - 1, day));

  const transaction = await prisma.transaction.create({
    data: {
      propertyId: template.propertyId,
      unitId: template.unitId,
      createdById: userId,
      type: "expense",
      date,
      amount: template.amount,
      detail: template.detail,
      note: template.note,
      category: template.category,
      recurringExpenseId: template.id,
    },
  });

  return NextResponse.json({
    ...transaction,
    date: transaction.date.toISOString().slice(0, 10),
    detail: transaction.detail ?? "",
    note: transaction.note ?? "",
  });
}
