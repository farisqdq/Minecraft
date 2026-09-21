import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { text } from "@/lib/maintenance";
import { addUpdate, requestForUser, requestInclude, serializeRequest } from "@/lib/requests";

/** A reply the tenant will see on their own thread. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requestForUser(me.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const note = text(body?.body, 2000);
  if (!note) return NextResponse.json({ error: "Type something first." }, { status: 400 });

  await addUpdate({
    requestId: id,
    authorName: me.name || me.email || "Your landlord",
    authorUserId: me.id,
    body: note,
  });

  const fresh = await prisma.maintenanceRequest.findUnique({ where: { id }, include: requestInclude });
  return NextResponse.json(serializeRequest(fresh!));
}
