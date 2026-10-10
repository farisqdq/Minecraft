import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty, requireTrip } from "@/lib/access";
import { parseTripInput } from "@/lib/mileage";
import { latestDay } from "@/lib/returns-db";
import { serializeTrip, tripDate } from "@/lib/trips-db";

/** Corrects a trip; moving it to another property needs access to that one too. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await requireTrip(userId, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseTripInput(
    {
      date: existing.date.toISOString().slice(0, 10),
      miles: existing.miles,
      purpose: existing.purpose,
      note: existing.note ?? "",
      ...(body ?? {}),
    },
    latestDay()
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  let propertyId = existing.propertyId;
  if (typeof body?.propertyId === "string" && body.propertyId !== existing.propertyId) {
    if (!(await requireProperty(userId, body.propertyId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    propertyId = body.propertyId;
  }
  const { date, miles, purpose, note } = parsed.value;
  const trip = await prisma.trip.update({
    where: { id },
    data: { propertyId, date: tripDate(date), miles, purpose, note: note || null },
  });
  return NextResponse.json(serializeTrip(trip));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireTrip(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.trip.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
