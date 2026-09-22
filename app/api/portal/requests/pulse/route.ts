import { NextResponse } from "next/server";
import { requireTenantSession } from "@/lib/tenant-access";
import { repairPulse } from "@/lib/pulse";

/** The same question, scoped to the one tenant asking it. */
export async function GET() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pulse = await repairPulse({ tenantId: me.tenant.id }, me.tenant.id);
  return NextResponse.json({ pulse });
}
