import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { markRead } from "@/lib/messages-db";

/**
 * The tenant has had the thread on screen. Called after a pause, not on
 * page load, so "read" means read rather than merely delivered.
 */
export async function POST() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const thread = await prisma.messageThread.findUnique({ where: { tenantId: me.tenant.id }, select: { id: true } });
  if (thread) await markRead(thread.id, "tenant");
  return NextResponse.json({ ok: true });
}
