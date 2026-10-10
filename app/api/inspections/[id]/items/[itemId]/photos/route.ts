import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BLOB_SETUP_MESSAGE, blobConfigured, inspectUpload } from "@/lib/blob";
import { storeFile } from "@/lib/storage";
import { MAX_PHOTOS_PER_ITEM } from "@/lib/inspections";
import { serializePhoto } from "@/lib/inspections-db";
import { inspectionFor } from "../../../../guard";

/**
 * A photo of one checklist line. These show the inside of someone's home,
 * so they go to private storage under a name nobody can work out, and are
 * served only through /api/files to the team and, once shared, the tenant.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;

  const item = await prisma.inspectionItem.findFirst({
    where: { id: itemId, inspectionId: id },
    include: { _count: { select: { photos: true } } },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item._count.photos >= MAX_PHOTOS_PER_ITEM) {
    return NextResponse.json({ error: `That's the ${MAX_PHOTOS_PER_ITEM}-photo limit for one line.` }, { status: 400 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No photo was uploaded." }, { status: 400 });
  const inspected = await inspectUpload(file, { imagesOnly: true });
  if ("error" in inspected) return NextResponse.json({ error: inspected.error }, { status: 400 });
  if (!blobConfigured()) return NextResponse.json({ error: BLOB_SETUP_MESSAGE }, { status: 503 });

  const safeName = (file.name || "photo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  let blob;
  try {
    blob = await storeFile(`inspections/${id}/${safeName}`, file, inspected.contentType);
  } catch (err) {
    console.error("Inspection photo upload failed", err);
    return NextResponse.json({ error: "Couldn't save that photo. Try again." }, { status: 502 });
  }

  const photo = await prisma.inspectionPhoto.create({
    data: {
      itemId,
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name || safeName,
      contentType: inspected.contentType,
      size: file.size,
      uploadedById: found.me.id,
    },
  });
  return NextResponse.json(serializePhoto(photo), { status: 201 });
}
