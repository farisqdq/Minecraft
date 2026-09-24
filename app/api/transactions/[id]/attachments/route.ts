import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { BLOB_SETUP_MESSAGE, blobConfigured, inspectUpload } from "@/lib/blob";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction || !(await requireProperty(userId, transaction.propertyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  // The type comes from the file's own bytes, not from what the browser
  // claimed — a "receipt.jpg" that is really a web page is refused.
  const inspected = await inspectUpload(file);
  if ("error" in inspected) return NextResponse.json({ error: inspected.error }, { status: 400 });
  const { contentType } = inspected;

  if (!blobConfigured()) {
    return NextResponse.json({ error: BLOB_SETUP_MESSAGE }, { status: 503 });
  }

  const safeName = (file.name || "proof").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

  let blob;
  try {
    blob = await put(`transactions/${id}/${Date.now()}-${safeName}`, file, {
      access: "public",
      contentType,
      // Public URLs are only as private as they are hard to guess.
      addRandomSuffix: true,
    });
  } catch (err) {
    console.error("Blob upload failed", err);
    return NextResponse.json(
      { error: "File storage rejected the upload. Check the Blob store in Vercel and try again." },
      { status: 502 }
    );
  }

  const attachment = await prisma.attachment.create({
    data: {
      transactionId: id,
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name || safeName,
      contentType,
      size: file.size,
      uploadedById: userId,
    },
  });

  return NextResponse.json(
    {
      id: attachment.id,
      transactionId: id,
      url: attachment.url,
      filename: attachment.filename,
      contentType: attachment.contentType,
    },
    { status: 201 }
  );
}
