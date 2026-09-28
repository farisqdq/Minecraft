import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireTenantSession } from "@/lib/tenant-access";
import { pushToDevices } from "@/lib/reminders-db";
import { testNotification } from "@/lib/reminders";
import { siteOrigin } from "@/lib/site";

/** A test push to the signed-in person's own devices — landlord or tenant. */
export async function POST(req: Request) {
  const origin = siteOrigin(req.url);
  const userId = await getCurrentUserId();
  if (userId) {
    const report = await pushToDevices({ userId }, testNotification({ company: "Rent Roll", url: `${origin}/dashboard/reminders` }));
    return NextResponse.json(report);
  }
  const tenant = await requireTenantSession();
  if (tenant) {
    const report = await pushToDevices(
      { tenantAccountId: tenant.accountId },
      testNotification({ company: tenant.property.company.name, url: `${origin}/portal` })
    );
    return NextResponse.json(report);
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
