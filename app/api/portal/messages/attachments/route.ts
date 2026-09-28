import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { attachToMessage } from "@/lib/message-files";

/**
 * A photo or file onto a message the tenant just sent. The thread is the
 * session's own; the message id in the form is checked against it, so a
 * guessed id belonging to someone else's conversation comes back 404
 * exactly as a made-up one would.
 */
export async function POST(req: Request) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const thread = await prisma.messageThread.findUnique({ where: { tenantId: me.tenant.id }, select: { id: true } });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const messageId = form?.get("messageId");
  if (typeof messageId !== "string" || !messageId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await attachToMessage({ threadId: thread.id, messageId, fromTenant: true, file: form?.get("file") });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.attachment, { status: 201 });
}
