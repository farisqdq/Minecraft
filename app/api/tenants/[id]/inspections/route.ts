import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { normalizeKind, parseHeaderInput } from "@/lib/inspections";
import { inspectionInclude, serializeInspection, startingItems } from "@/lib/inspections-db";
import { latestDay } from "@/lib/returns-db";

/**
 * Starts a move-in or move-out inspection for a tenant (a32). A move-in
 * starts from the standard checklist; a move-out from the tenant's move-in,
 * item for item, so every line has something to be compared with.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = normalizeKind(body?.kind);
  if (!kind) return NextResponse.json({ error: "Move-in or move-out?" }, { status: 400 });
  const header = parseHeaderInput(body, latestDay());
  if (!header.ok) return NextResponse.json({ error: header.error }, { status: 400 });

  const items = await startingItems(id, kind);
  const inspection = await prisma.inspection.create({
    data: {
      tenantId: id,
      kind,
      inspectedOn: new Date(`${header.value.inspectedOn}T00:00:00Z`),
      note: header.value.note || null,
      createdById: userId,
      items: {
        create: items.map((item, position) => ({
          room: item.room,
          name: item.name,
          condition: item.condition,
          note: item.note || null,
          position,
        })),
      },
    },
    include: inspectionInclude,
  });
  return NextResponse.json(serializeInspection(inspection), { status: 201 });
}
