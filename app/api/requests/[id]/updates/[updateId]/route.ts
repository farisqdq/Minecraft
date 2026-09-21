import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requestForUser, requestInclude, serializeRequest } from "@/lib/requests";

/**
 * Remove one line from a repair's thread — a reply from either side, or a
 * status entry that was only ever noise (three taps while deciding leaves
 * three rows the tenant has to read past).
 *
 * Landlord side only: the portal has no delete, so a tenant can't erase what
 * they reported. Deleting a status entry removes the note about the change,
 * not the change — the request's own status is a column and is left alone.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; updateId: string }> }
) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, updateId } = await params;
  if (!(await requestForUser(me.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Scoped to this request as well as to the id, so a message on someone
  // else's property can't be deleted by passing its id to a request you can
  // reach.
  const removed = await prisma.maintenanceUpdate.deleteMany({
    where: { id: updateId, requestId: id },
  });
  if (removed.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const fresh = await prisma.maintenanceRequest.findUnique({ where: { id }, include: requestInclude });
  return NextResponse.json(serializeRequest(fresh!));
}
