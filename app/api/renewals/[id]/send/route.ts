import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { ensureThread, notifyNewMessage, postMessage } from "@/lib/messages-db";
import { renewalLetter } from "@/lib/renewals-db";
import { siteOrigin } from "@/lib/site";

/**
 * Sends the renewal notice to the tenant's Messages thread — which emails
 * and pushes them like any message — and records when. Notice in writing,
 * with a date on it, is the point.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const letter = await renewalLetter(id);
  if (!letter || !(await requireTenant(me.id, letter.tenant.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const thread = await ensureThread(letter.tenant.id);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await postMessage({
    threadId: thread.id,
    fromTenant: false,
    authorName: me.name || me.email || "Your landlord",
    authorUserId: me.id,
    body: letter.text,
  });
  const sentAt = new Date();
  await prisma.leaseRenewal.update({ where: { id }, data: { sentAt } });

  const origin = siteOrigin(req.url);
  after(() =>
    notifyNewMessage({ threadId: thread.id, fromTenant: false, origin }).catch((err) => console.error("Renewal notify", err))
  );
  return NextResponse.json({ sentAt: sentAt.toISOString() });
}
