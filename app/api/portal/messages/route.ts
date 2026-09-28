import { NextResponse, after } from "next/server";
import { requireTenantSession } from "@/lib/tenant-access";
import { ensureThread, notifyNewMessage, postMessage, serializeMessage, tenantMessagesLastHour, threadForTenant } from "@/lib/messages-db";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_TENANT_MESSAGES_PER_HOUR, cleanBody } from "@/lib/messages";
import { siteOrigin } from "@/lib/site";

/**
 * The signed-in tenant's one conversation with their landlord's company.
 *
 * Scoped by the session, never by an id in the request: there is no thread
 * or tenant id a portal client could send, so there is nothing to tamper
 * with. The same rule the rest of the portal follows.
 */
export async function GET() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const thread = await threadForTenant(me.tenant.id, "tenant");
  return NextResponse.json(thread);
}

/**
 * Send a message. Files come afterwards, one at a time, against the
 * message that now exists — so a message may start empty when the client
 * says attachments are on the way.
 */
export async function POST(req: Request) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const body = cleanBody(raw?.body);
  const attachments = Math.min(MAX_ATTACHMENTS_PER_MESSAGE, Math.max(0, Math.round(Number(raw?.attachments) || 0)));
  if (!body && attachments === 0) return NextResponse.json({ error: "Type something first." }, { status: 400 });

  const thread = await ensureThread(me.tenant.id);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if ((await tenantMessagesLastHour(thread.id)) >= MAX_TENANT_MESSAGES_PER_HOUR) {
    return NextResponse.json(
      { error: "That's a lot of messages for one hour. Call the office if it's urgent." },
      { status: 429 }
    );
  }

  const message = await postMessage({ threadId: thread.id, fromTenant: true, authorName: me.tenant.name, body });

  // The team hears about it once the message is saved, without the reply
  // waiting on a mail server. Batched per half hour in lib/messages-db.
  const origin = siteOrigin(req.url);
  after(() =>
    notifyNewMessage({ threadId: thread.id, fromTenant: true, origin, pendingFiles: attachments }).catch((err) =>
      console.error("Message notify", err)
    )
  );

  return NextResponse.json(serializeMessage(message, "tenant", me.property.company.name), { status: 201 });
}
