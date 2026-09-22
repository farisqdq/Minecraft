import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import type { NoticeDTO } from "@/lib/notices";

/**
 * Notices for the signed-in tenant, and marking them read.
 *
 * Scoped by the session, never by an id in the URL, so there is no id to
 * tamper with — the same rule the rest of the portal follows.
 */
export async function GET() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.tenantNotice.findMany({
    where: { tenantId: me.tenant.id },
    include: { sentBy: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const notices: NoticeDTO[] = rows.map((n) => ({
    id: n.id,
    kind: n.kind === "note" ? "note" : "rent",
    month: n.month ?? "",
    amount: n.amount ?? 0,
    body: n.body,
    // Deliberately not the sender's name or email — a tenant deals with the
    // company, and the landlord's own details are not theirs to have.
    sentBy: "",
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : "",
  }));
  return NextResponse.json(notices);
}

/**
 * Mark everything read. Called when the tenant has actually had the notices
 * on screen, so "read" means read rather than merely delivered — which is
 * the distinction that matters if it is ever produced as evidence.
 */
export async function POST() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.tenantNotice.updateMany({
    where: { tenantId: me.tenant.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
