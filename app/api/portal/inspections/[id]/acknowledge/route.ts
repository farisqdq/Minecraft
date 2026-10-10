import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { KIND_LABEL, normalizeKind, parseAcknowledgement } from "@/lib/inspections";
import { ensureThread, notifyNewMessage, postMessage } from "@/lib/messages-db";
import { siteOrigin } from "@/lib/site";

/**
 * The tenant signs off on an inspection shared with them: their typed name,
 * the moment, and anything they see differently. After this nobody can
 * change the report — not the landlord, not them.
 *
 * Their comment also goes into the Messages thread, so the landlord sees it
 * where they already look, and has a written answer to give.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // Scoped by the session's tenant, and only once shared: anything else is "not found".
  const inspection = await prisma.inspection.findFirst({
    where: { id, tenantId: me.tenant.id, sharedAt: { not: null } },
  });
  if (!inspection) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (inspection.acknowledgedAt) return NextResponse.json({ error: "You've already acknowledged this one." }, { status: 409 });

  const parsed = parseAcknowledgement(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const acknowledgedAt = new Date();
  // Only the first signature counts, even with two taps at once.
  const { count } = await prisma.inspection.updateMany({
    where: { id, acknowledgedAt: null },
    data: { acknowledgedAt, acknowledgedName: parsed.value.name, tenantComment: parsed.value.comment || null },
  });
  if (count === 0) return NextResponse.json({ error: "You've already acknowledged this one." }, { status: 409 });

  const thread = await ensureThread(me.tenant.id);
  if (thread) {
    const label = KIND_LABEL[normalizeKind(inspection.kind) ?? "move_in"];
    await postMessage({
      threadId: thread.id,
      fromTenant: true,
      authorName: me.tenant.name,
      body: parsed.value.comment
        ? `I've acknowledged the ${label.toLowerCase()}, with a note: ${parsed.value.comment}`
        : `I've acknowledged the ${label.toLowerCase()}.`,
    });
    const origin = siteOrigin(req.url);
    after(() =>
      notifyNewMessage({ threadId: thread.id, fromTenant: true, origin }).catch((err) =>
        console.error("Inspection acknowledgement notify", err)
      )
    );
  }

  return NextResponse.json({
    acknowledgedAt: acknowledgedAt.toISOString(),
    acknowledgedName: parsed.value.name,
    tenantComment: parsed.value.comment,
  });
}
