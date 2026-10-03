import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireListing } from "@/lib/access";
import { parseListing } from "@/lib/listings";
import { allowedPhotoIds, listingData, serializeListing } from "@/lib/listings-db";

/** Edits a listing, or opens and closes it: `{ open: false }` stops new applications. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const listing = await requireListing(userId, id);
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  let data: Record<string, unknown>;
  if (typeof body?.open === "boolean" && Object.keys(body).length === 1) {
    data = { open: body.open, closedAt: body.open ? null : new Date() };
  } else {
    const parsed = parseListing(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    data = { ...listingData(parsed.value), photoIds: await allowedPhotoIds(listing.propertyId, parsed.value.photoIds) };
  }
  const saved = await prisma.listing.update({ where: { id }, data, include: { applications: { select: { status: true } } } });
  return NextResponse.json(serializeListing(saved));
}

/**
 * Deletes a listing and every application to it — strangers' personal
 * details nobody needs to keep. Owners only: it can't be undone. An approved
 * applicant's tenant record stays.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireListing(userId, id, "owner"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.listing.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
