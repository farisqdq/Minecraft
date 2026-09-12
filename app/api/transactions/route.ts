import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

function serialize<T extends { date: Date; detail: string | null; note: string | null }>(t: T) {
  return { ...t, date: t.date.toISOString().slice(0, 10), detail: t.detail ?? "", note: t.note ?? "" };
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const transactions = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transactions.map(serialize));
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
  const type = body?.type === "expense" ? "expense" : "rent";
  const date = typeof body?.date === "string" ? new Date(body.date) : null;
  const amount = Number(body?.amount);
  const detail = typeof body?.detail === "string" ? body.detail.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!propertyId || !date || isNaN(date.getTime()) || !(amount > 0)) {
    return NextResponse.json({ error: "Missing or invalid fields." }, { status: 400 });
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.userId !== userId) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  const transaction = await prisma.transaction.create({
    data: { userId, propertyId, type, date, amount, detail: detail || null, note: note || null },
  });
  return NextResponse.json(serialize(transaction), { status: 201 });
}
