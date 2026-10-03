import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { parseListing } from "@/lib/listings";
import { createListing, serializeListing } from "@/lib/listings-db";

/** Lists a place in this property for rent (a27). Anyone on the team may. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const property = await requireProperty(userId, id);
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  let unitId: string | null = null;
  if (typeof body?.unitId === "string" && body.unitId) {
    const unit = await prisma.unit.findUnique({ where: { id: body.unitId } });
    if (!unit || unit.propertyId !== id) return NextResponse.json({ error: "That unit isn't part of this property." }, { status: 400 });
    unitId = unit.id;
  }
  const parsed = parseListing(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const listing = await createListing(userId, property, unitId, parsed.value);
  return NextResponse.json(serializeListing(listing), { status: 201 });
}
