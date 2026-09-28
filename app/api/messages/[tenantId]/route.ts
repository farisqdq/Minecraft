import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { ensureThread, notifyNewMessage, postMessage, serializeMessage, threadForTenant } from "@/lib/messages-db";
import { MAX_ATTACHMENTS_PER_MESSAGE, cleanBody } from "@/lib/messages";
import { siteOrigin } from "@/lib/site";

/**
 * One tenant's conversation, for a landlord on that tenant's team.
 * requireTenant is the gate: a tenant id from another LLC comes back 404
 * exactly as a made-up one would.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId } = await params;
  if (!(await requireTenant(me.id, tenantId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thread = await threadForTenant(tenantId, "landlord");
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(thread);
}

/** Write to the tenant. Files follow one at a time, against the message that now exists. */
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId } = await params;
  const tenant = await requireTenant(me.id, tenantId);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = await req.json().catch(() => null);
  const body = cleanBody(raw?.body);
  const attachments = Math.min(MAX_ATTACHMENTS_PER_MESSAGE, Math.max(0, Math.round(Number(raw?.attachments) || 0)));
  if (!body && attachments === 0) return NextResponse.json({ error: "Type something first." }, { status: 400 });

  const thread = await ensureThread(tenantId);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const message = await postMessage({
    threadId: thread.id,
    fromTenant: false,
    authorName: me.name || me.email || "Your landlord",
    authorUserId: me.id,
    body,
  });

  // The tenant hears about it once the message is saved, without this
  // reply waiting on a mail server. Batched per half hour in lib/messages-db.
  const origin = siteOrigin(req.url);
  after(() =>
    notifyNewMessage({ threadId: thread.id, fromTenant: false, origin, pendingFiles: attachments }).catch((err) =>
      console.error("Message notify", err)
    )
  );

  return NextResponse.json(serializeMessage(message, "landlord", ""), { status: 201 });
}
