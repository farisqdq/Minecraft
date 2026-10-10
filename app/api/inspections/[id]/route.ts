import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseHeaderInput } from "@/lib/inspections";
import { latestDay } from "@/lib/returns-db";
import { releaseBlob } from "@/lib/blob-release";
import { inspectionFor } from "../guard";

/** The day of the walk-through and the overall note. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await inspectionFor(id);
  if (!found.ok) return found.res;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseHeaderInput(
    { inspectedOn: found.inspection.inspectedOn.toISOString().slice(0, 10), note: found.inspection.note ?? "", ...(body ?? {}) },
    latestDay()
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updated = await prisma.inspection.update({
    where: { id },
    data: { inspectedOn: new Date(`${parsed.value.inspectedOn}T00:00:00Z`), note: parsed.value.note || null },
  });
  return NextResponse.json({ inspectedOn: parsed.value.inspectedOn, note: updated.note ?? "" });
}

/**
 * Removes an inspection and its photos. A draft is anyone's to throw away;
 * one the tenant has signed is evidence, so only an owner can.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const first = await inspectionFor(id, { unlocked: false });
  if (!first.ok) return first.res;
  if (first.inspection.acknowledgedAt) {
    const owner = await inspectionFor(id, { role: "owner", unlocked: false });
    if (!owner.ok) {
      return owner.res.status === 403
        ? NextResponse.json({ error: "It's been acknowledged by the tenant — only an owner can remove it." }, { status: 403 })
        : owner.res;
    }
  }
  const photos = await prisma.inspectionPhoto.findMany({ where: { item: { inspectionId: id } }, select: { url: true } });
  await prisma.inspection.delete({ where: { id } });
  for (const p of photos) await releaseBlob(p.url).catch((err) => console.error("Inspection photo release", err));
  return NextResponse.json({ ok: true });
}
