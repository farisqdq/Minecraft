import { NextResponse } from "next/server";
import { requireTenantSession } from "@/lib/tenant-access";
import { tenantUnread } from "@/lib/messages-db";

/** The number on the portal's Messages badge: what the landlord wrote that they haven't seen. */
export async function GET() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ count: await tenantUnread(me.tenant.id) });
}
