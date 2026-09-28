import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { attachToMessage } from "@/lib/message-files";

/** A photo or file onto a message someone on the team just sent. */
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId } = await params;
  if (!(await requireTenant(userId, tenantId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thread = await prisma.messageThread.findUnique({ where: { tenantId }, select: { id: true } });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const messageId = form?.get("messageId");
  if (typeof messageId !== "string" || !messageId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await attachToMessage({ threadId: thread.id, messageId, fromTenant: false, file: form?.get("file") });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.attachment, { status: 201 });
}
