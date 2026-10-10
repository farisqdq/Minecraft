import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MAX_ITEMS, parseItemInput } from "@/lib/inspections";
import { serializeItem } from "@/lib/inspections-db";
import { inspectionFor } from "../../guard";

/**
 * Adds a line to the checklist — at the end of its room when the room
 * exists, so "Bedroom 2 · Ceiling fan" lands with Bedroom 2's other items.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;

  const parsed = parseItemInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const item = await prisma.$transaction(async (tx) => {
    const items = await tx.inspectionItem.findMany({
      where: { inspectionId: id },
      select: { room: true, position: true },
      orderBy: { position: "asc" },
    });
    if (items.length >= MAX_ITEMS) return null;
    const sameRoom = items.filter((i) => i.room.trim().toLowerCase() === parsed.value.room.toLowerCase());
    const position = sameRoom.length > 0 ? sameRoom[sameRoom.length - 1].position + 1 : (items.at(-1)?.position ?? -1) + 1;
    await tx.inspectionItem.updateMany({
      where: { inspectionId: id, position: { gte: position } },
      data: { position: { increment: 1 } },
    });
    return tx.inspectionItem.create({
      data: {
        inspectionId: id,
        // Join the existing room under its existing spelling.
        room: sameRoom.length > 0 ? items.find((i) => i.room.trim().toLowerCase() === parsed.value.room.toLowerCase())!.room : parsed.value.room,
        name: parsed.value.name,
        condition: parsed.value.condition,
        note: parsed.value.note || null,
        position,
      },
      include: { photos: true },
    });
  });
  if (!item) return NextResponse.json({ error: `That's the ${MAX_ITEMS}-line limit for one inspection.` }, { status: 400 });
  return NextResponse.json(serializeItem(item), { status: 201 });
}
