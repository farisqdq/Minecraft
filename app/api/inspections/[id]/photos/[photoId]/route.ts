import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseBlob } from "@/lib/blob-release";
import { inspectionFor } from "../../../guard";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const { id, photoId } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;
  const photo = await prisma.inspectionPhoto.findFirst({ where: { id: photoId, item: { inspectionId: id } } });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.inspectionPhoto.delete({ where: { id: photoId } });
  await releaseBlob(photo.url).catch((err) => console.error("Inspection photo release", err));
  return NextResponse.json({ ok: true });
}
