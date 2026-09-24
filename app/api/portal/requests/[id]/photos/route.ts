import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { BLOB_SETUP_MESSAGE, blobConfigured, inspectUpload } from "@/lib/blob";
import { storeFile } from "@/lib/storage";
import { fileLink } from "@/lib/file-links";
import { MAX_PHOTOS } from "@/lib/maintenance";
import { requestForTenant } from "@/lib/requests";

/**
 * A photo of the problem, uploaded by the tenant.
 *
 * This is the one place in the app where someone outside the landlord's team
 * can put a file into storage, so it is capped three ways: the request must
 * be one they filed, the file must be an image under 4 MB, and a request
 * tops out at MAX_PHOTOS.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await requestForTenant(me.tenant.id, id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (request.photos.length >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `That's the ${MAX_PHOTOS}-photo limit for one report.` },
      { status: 400 }
    );
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No photo was uploaded." }, { status: 400 });
  }
  // No PDFs here — a tenant reporting a leak is sending a photo — and the
  // type is read from the file's bytes, not from what the phone claimed.
  const inspected = await inspectUpload(file, { imagesOnly: true });
  if ("error" in inspected) return NextResponse.json({ error: inspected.error }, { status: 400 });
  const { contentType } = inspected;

  if (!blobConfigured()) {
    return NextResponse.json({ error: BLOB_SETUP_MESSAGE }, { status: 503 });
  }

  const safeName = (file.name || "photo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

  let blob;
  try {
    // These can show the inside of someone's home: private storage, and a
    // name nobody can work out.
    blob = await storeFile(`requests/${id}/${safeName}`, file, contentType);
  } catch (err) {
    console.error("Blob upload failed", err);
    return NextResponse.json({ error: "Couldn't save that photo. Try again." }, { status: 502 });
  }

  const photo = await prisma.maintenancePhoto.create({
    data: {
      requestId: id,
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name || safeName,
      contentType,
      size: file.size,
    },
  });

  return NextResponse.json(
    { id: photo.id, url: fileLink("photo", photo.id), filename: photo.filename, contentType: photo.contentType },
    { status: 201 }
  );
}
