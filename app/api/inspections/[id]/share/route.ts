import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureThread, notifyNewMessage, postMessage } from "@/lib/messages-db";
import { siteOrigin } from "@/lib/site";
import { KIND_LABEL, normalizeKind } from "@/lib/inspections";
import { inspectionFor } from "../../guard";

/**
 * Shares an inspection with the tenant in the portal, or takes it back.
 *
 * Sharing also says so in their Messages thread — which emails and pushes
 * them like any message — because a report nobody knows is waiting never
 * gets read, let alone acknowledged. Once acknowledged it stays shared.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const share = body?.shared !== false;
  const found = await inspectionFor(id, { unlocked: !share });
  if (!found.ok) return found.res;
  const { inspection, me } = found;

  if (!share) {
    await prisma.inspection.update({ where: { id }, data: { sharedAt: null } });
    return NextResponse.json({ sharedAt: null });
  }
  if (inspection.sharedAt) return NextResponse.json({ sharedAt: inspection.sharedAt.toISOString() });

  const sharedAt = new Date();
  await prisma.inspection.update({ where: { id }, data: { sharedAt } });

  const thread = await ensureThread(inspection.tenantId);
  if (thread) {
    const label = KIND_LABEL[normalizeKind(inspection.kind) ?? "move_in"].toLowerCase();
    const day = inspection.inspectedOn.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    await postMessage({
      threadId: thread.id,
      fromTenant: false,
      authorName: me.name || me.email || "Your landlord",
      authorUserId: me.id,
      body:
        `Your ${label} from ${day} is ready for you to review, under Inspections in the portal. ` +
        "Please check each room against what you see, then acknowledge it — and if anything looks different to you, say so there; it's kept with the report.",
    });
    const origin = siteOrigin(req.url);
    after(() =>
      notifyNewMessage({ threadId: thread.id, fromTenant: false, origin }).catch((err) =>
        console.error("Inspection notify", err)
      )
    );
  }
  return NextResponse.json({ sharedAt: sharedAt.toISOString() });
}
