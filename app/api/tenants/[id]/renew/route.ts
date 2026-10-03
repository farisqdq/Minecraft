import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { isoDay } from "@/lib/lease";
import { parseRenewal } from "@/lib/renewal";
import { renewLease } from "@/lib/renewals-db";

/**
 * Renews a current tenant's lease, with the rent it will be from a month
 * that hasn't passed. Anyone on the LLC's team may — the same people who
 * can edit a tenant's lease dates and a place's rent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const tenant = await requireTenant(userId, id);
  if (!tenant) return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
  if (!tenant.active) return NextResponse.json({ error: "Only a current tenant's lease can be renewed." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = parseRenewal(body, {
    previousEnd: tenant.leaseEnd ? isoDay(tenant.leaseEnd) : "",
    today: isoDay(new Date()),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await renewLease(userId, tenant, parsed.value);
  return NextResponse.json(result, { status: 201 });
}
