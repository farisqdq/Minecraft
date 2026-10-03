import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CODE_PATTERN } from "@/lib/listings";
import { fetchFile } from "@/lib/storage";
import { sniffContentType } from "@/lib/blob";

/**
 * A listing's photo, for anyone with the listing's link (a27). Only a
 * document the listing names, of that property, filed as a photo, and only
 * while the listing is open — closing it takes the photos down with it.
 * Images only: anything else is refused rather than served.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string; docId: string }> }) {
  const { code, docId } = await params;
  if (!CODE_PATTERN.test(code)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const listing = await prisma.listing.findUnique({ where: { code }, select: { open: true, propertyId: true, photoIds: true } });
  if (!listing?.open || !listing.photoIds.includes(docId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = await prisma.document.findUnique({ where: { id: docId }, select: { url: true, propertyId: true, kind: true } });
  if (!doc || doc.propertyId !== listing.propertyId || doc.kind !== "Photo") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await fetchFile(doc.url);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const type = sniffContentType(bytes.subarray(0, 16));
  if (!type?.startsWith("image/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      // Public while the listing is, but never kept by a shared cache:
      // closing the listing has to take the photos down.
      "Cache-Control": "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
