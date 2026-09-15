import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { BLOB_SETUP_MESSAGE, MAX_UPLOAD_BYTES, blobConfigured, resolveContentType } from "@/lib/blob";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction || !(await requireProperty(userId, transaction.propertyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!blobConfigured()) {
    return NextResponse.json({ error: BLOB_SETUP_MESSAGE }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  const contentType = resolveContentType(file.type, file.name || "");
  if (!contentType) {
    return NextResponse.json(
      { error: "Attach a photo (JPG, PNG, HEIC, WebP) or a PDF receipt." },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too large — keep it under 4 MB." }, { status: 400 });
  }

  const safeName = (file.name || "proof").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

  let blob;
  try {
    blob = await put(`transactions/${id}/${Date.now()}-${safeName}`, file, {
      access: "public",
      contentType,
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
