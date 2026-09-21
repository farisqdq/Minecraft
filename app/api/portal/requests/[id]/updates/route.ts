import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { text } from "@/lib/maintenance";
import { addUpdate, requestForTenant, requestInclude, serializeRequest } from "@/lib/requests";

/** The tenant adding to their own report: "it's worse today". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await requestForTenant(me.tenant.id, id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const note = text(body?.body, 2000);
  if (!note) return NextResponse.json({ error: "Type something first." }, { status: 400 });

  await addUpdate({
    requestId: id,
    authorName: me.tenant.name,
    authorTenantId: me.tenant.id,
    body: note,
  });

  // A tenant chasing a closed request reopens it — otherwise the reply lands
  // in a thread nobody is looking at any more.
  if (request.status === "done" || request.status === "declined") {
    await prisma.maintenanceRequest.update({
      where: { id },
      data: { status: "seen", resolvedAt: null },
    });
    await addUpdate({
      requestId: id,
      authorName: me.tenant.name,
      authorTenantId: me.tenant.id,
      body: "Reopened by the tenant",
      statusTo: "seen",
    });
  }

  const fresh = await prisma.maintenanceRequest.findUnique({ where: { id }, include: requestInclude });
  return NextResponse.json(serializeRequest(fresh!), { status: 201 });
}
