import { NextResponse } from "next/server";
import { requireTenantSession } from "@/lib/tenant-access";
import { messagePulse, repairPulse } from "@/lib/pulse";

/**
 * The same question, scoped to the one tenant asking it. Their message
 * thread rides along, so the one poll covers everything on the portal page.
 */
export async function GET() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [repairs, messages] = await Promise.all([
    repairPulse({ tenantId: me.tenant.id }, me.tenant.id),
    messagePulse({ thread: { tenantId: me.tenant.id } }),
  ]);
  return NextResponse.json({ pulse: `${repairs}.${messages}` });
}
