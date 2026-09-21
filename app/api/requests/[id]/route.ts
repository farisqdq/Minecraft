import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { normalizeStatus, STATUS_LABEL, text } from "@/lib/maintenance";
import { addUpdate, requestForUser, requestInclude, serializeRequest } from "@/lib/requests";

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
  return NextResponse.json(serializeRequest(fresh!));
}
