import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { parseTripInput } from "@/lib/mileage";
import { latestDay } from "@/lib/returns-db";
import { serializeTrip, tripDate } from "@/lib/trips-db";

/** Logs a drive to this property (a33). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireProperty(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseTripInput(await req.json().catch(() => null), latestDay());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { date, miles, purpose, note } = parsed.value;
  const trip = await prisma.trip.create({
    data: { propertyId: id, date: tripDate(date), miles, purpose, note: note || null, createdById: userId },
  });
  return NextResponse.json(serializeTrip(trip), { status: 201 });
}
