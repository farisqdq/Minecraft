import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { parseValuationInput } from "@/lib/returns";
import { dateOf, serializeValuation, latestDay } from "@/lib/returns-db";

/** Records what a property is worth on a day (a31). The latest one is its value. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseValuationInput(await req.json().catch(() => null), latestDay());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { value, asOf, source, note } = parsed.value;
  const valuation = await prisma.propertyValuation.create({
    data: { propertyId: id, value, asOf: dateOf(asOf), source: source || null, note: note || null, createdById: userId },
  });
  return NextResponse.json(serializeValuation(valuation), { status: 201 });
}
