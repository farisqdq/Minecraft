import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseBlob } from "@/lib/blob-release";
import { inspectionFor } from "../../guard";

const roomName = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 60) : "");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function roomItems(inspectionId: string, room: string) {
  const items = await prisma.inspectionItem.findMany({ where: { inspectionId }, include: { photos: true } });
  return items.filter((i) => same(i.room, room));
}

/** Renames a room — every line in it — as one change. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const from = roomName(body?.from);
  const to = roomName(body?.to);
  if (!from || !to) return NextResponse.json({ error: "Give the room a name." }, { status: 400 });
  const items = await roomItems(id, from);
  if (items.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.inspectionItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { room: to } });
  return NextResponse.json({ room: to });
}

/** Removes a room that isn't in this place — the second bathroom a one-bath unit doesn't have. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;
  const room = roomName(new URL(req.url).searchParams.get("room"));
  const items = await roomItems(id, room);
  if (!room || items.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.inspectionItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  for (const p of items.flatMap((i) => i.photos)) {
    await releaseBlob(p.url).catch((err) => console.error("Inspection photo release", err));
  }
  return NextResponse.json({ ok: true });
}
