import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireRecurring } from "@/lib/access";
import { normalizeCategory } from "@/lib/categories";
import { parseRecurringOverrides } from "@/lib/quick-record";

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
  // "Log it" opens the expense form now, so the amount, date (inside this
  // month), payee, note and category may have been changed before saving.
  // Anything not sent is the template's, as before.
  const overrides = parseRecurringOverrides(body, monthKey, (c) => normalizeCategory(c) !== null);
  if (!overrides.ok) return NextResponse.json({ error: overrides.error }, { status: 400 });
  const o = overrides.value;
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
  const date = o.date ? new Date(`${o.date}T00:00:00.000Z`) : new Date(Date.UTC(year, month - 1, day));

  const transaction = await prisma.transaction.create({
    data: {
      propertyId: template.propertyId,
      unitId: template.unitId,
      createdById: userId,
      type: "expense",
      date,
      amount: o.amount ?? template.amount,
      detail: o.detail ?? template.detail,
      note: o.note ?? template.note,
      category: o.category ?? template.category,
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
