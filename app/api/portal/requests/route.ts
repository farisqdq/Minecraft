import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-access";
import { MAX_REPORTS_PER_DAY, normalizeCategory, text } from "@/lib/maintenance";
import { requestInclude, serializeRequest } from "@/lib/requests";

/** Only ever this tenant's own reports. */
export async function GET() {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.maintenanceRequest.findMany({
    where: { tenantId: me.tenant.id },
    include: requestInclude,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows.map(serializeRequest));
}

export async function POST(req: Request) {
  const me = await requireTenantSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = text(body?.title, 120);
  const detail = text(body?.detail, 4000);
  const place = text(body?.place, 80);
  const category = normalizeCategory(body?.category);
  const urgency = body?.urgency === "urgent" ? "urgent" : "normal";

  if (!title) return NextResponse.json({ error: "Say in a few words what's wrong." }, { status: 400 });
  if (!category) return NextResponse.json({ error: "Pick what kind of problem it is." }, { status: 400 });

  const today = await prisma.maintenanceRequest.count({
    where: { tenantId: me.tenant.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
  });
  if (today >= MAX_REPORTS_PER_DAY) {
    return NextResponse.json(
      { error: "That's a lot of reports for one day. Call the office if something else is wrong." },
      { status: 429 }
    );
  }

  // The property and unit come from the tenant's own record, never from the
  // request body — there is no field here that could point somewhere else.
  const created = await prisma.maintenanceRequest.create({
    data: {
      propertyId: me.tenant.propertyId,
      unitId: me.tenant.unitId,
      tenantId: me.tenant.id,
      title,
      detail,
      place: place || null,
      category,
      urgency,
    },
    include: requestInclude,
  });

  return NextResponse.json(serializeRequest(created), { status: 201 });
}
