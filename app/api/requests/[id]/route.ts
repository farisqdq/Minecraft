import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { blobConfigured } from "@/lib/blob";
import { getCurrentUser } from "@/lib/session";
import { normalizeStatus, STATUS_LABEL, text } from "@/lib/maintenance";
import { addUpdate, requestForUser, requestInclude, serializeRequestForLandlord } from "@/lib/requests";

/** Move a request along the queue, optionally with a note to the tenant. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await requestForUser(me.id, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const status = normalizeStatus(body?.status);
  if (!status) return NextResponse.json({ error: "Unknown status." }, { status: 400 });

  const note = text(body?.note, 2000);
  const who = me.name || me.email || "Your landlord";
  const now = new Date();

  if (status !== existing.status) {
    await prisma.maintenanceRequest.update({
      where: { id },
      data: {
        status,
        // First time it leaves "open" is the response time that matters.
        seenAt: existing.seenAt ?? now,
        resolvedAt: status === "done" || status === "declined" ? now : null,
      },
    });
    await addUpdate({
      requestId: id,
      authorName: who,
      authorUserId: me.id,
      body: STATUS_LABEL[status].landlord,
      statusTo: status,
    });
  }

  if (note) {
    await addUpdate({ requestId: id, authorName: who, authorUserId: me.id, body: note });
  }

  const fresh = await prisma.maintenanceRequest.findUnique({ where: { id }, include: requestInclude });
  return NextResponse.json(serializeRequestForLandlord(fresh!));
}

/**
 * Throw a whole repair away: the report, its photos and the entire thread.
 *
 * The ledger entry is deliberately left alone. Booking the cost is a record
 * of money that left the account — it belongs to the books, not to the
 * conversation about the leak — so deleting the report never quietly rewrites
 * what a property earned. The confirmation says so before you agree to it.
 *
 * Photos are pulled out of blob storage first. A row pointing at a file that
 * is gone renders as a broken thumbnail; a file with no row is invisible and
 * costs pennies, so the delete goes ahead even if storage says no.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await requestForUser(me.id, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (blobConfigured() && existing.photos.length > 0) {
    await Promise.all(existing.photos.map((p) => del(p.url).catch(() => undefined)));
  }

  // Updates and photos are cascade-deleted by the schema.
  await prisma.maintenanceRequest.delete({ where: { id } });

  return NextResponse.json({
    ok: true,
    keptTransaction: Boolean(existing.transactionId),
  });
}
