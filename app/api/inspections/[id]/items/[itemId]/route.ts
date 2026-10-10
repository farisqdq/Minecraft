import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseItemInput } from "@/lib/inspections";
import { serializeItem } from "@/lib/inspections-db";
import { releaseBlob } from "@/lib/blob-release";
import { inspectionFor } from "../../../guard";

async function itemOf(inspectionId: string, itemId: string) {
  return prisma.inspectionItem.findFirst({ where: { id: itemId, inspectionId }, include: { photos: true } });
}

/** A condition picked, a note typed, a line renamed. Fields left out keep their value. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;
  const existing = await itemOf(id, itemId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseItemInput({
    room: existing.room,
    name: existing.name,
    condition: existing.condition,
    note: existing.note ?? "",
    ...(body ?? {}),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const item = await prisma.inspectionItem.update({
    where: { id: itemId },
    data: { ...parsed.value, note: parsed.value.note || null },
    include: { photos: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json(serializeItem(item));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;
  const existing = await itemOf(id, itemId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.inspectionItem.delete({ where: { id: itemId } });
  for (const p of existing.photos) await releaseBlob(p.url).catch((err) => console.error("Inspection photo release", err));
  return NextResponse.json({ ok: true });
}
