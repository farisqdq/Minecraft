import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { markRead } from "@/lib/messages-db";

/**
 * Someone on the team has had the thread on screen. One stamp for the
 * whole team: the tenant is talking to the company, and one person
 * reading it is the company reading it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantId } = await params;
  if (!(await requireTenant(userId, tenantId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thread = await prisma.messageThread.findUnique({ where: { tenantId }, select: { id: true } });
  if (thread) await markRead(thread.id, "landlord");
  return NextResponse.json({ ok: true });
}
