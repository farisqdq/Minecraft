import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { lateFeeStatuses, type LateFeeStatus } from "@/lib/late-fees-db";

export const maxDuration = 60;

/** A dashboard's worth of cards; more than this is a different job. */
const MAX_TENANTS = 50;

/**
 * Late fees for the tenants on the dashboard's cards: applies any fee that
 * is due now (the same idempotent path as "Run late fees now", so asking
 * twice charges nothing twice) and says, per tenant, this month's late fees,
 * the most the month can carry, and the line explaining what was charged or
 * why nothing was.
 *
 *   POST { tenantIds: string[] }  (at most 50)
 *   → { statuses: { [tenantId]: { month, fees, cap, line: { tenantName, tone, text } } } }
 *
 * A tenant the user can't reach is left out, exactly as one that doesn't
 * exist — the answer never says which ids are real.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const raw: unknown = body?.tenantIds;
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "Send tenantIds: a list of tenant ids." }, { status: 400 });
  }
  const ids = [...new Set(raw as string[])].filter(Boolean);
  if (ids.length > MAX_TENANTS) {
    return NextResponse.json({ error: `At most ${MAX_TENANTS} tenants at a time.` }, { status: 400 });
  }

  const reachable: string[] = [];
  for (const id of ids) if (await requireTenant(userId, id)) reachable.push(id);

  const statuses: Record<string, Omit<LateFeeStatus, "tenantId">> = {};
  for (const { tenantId, ...status } of await lateFeeStatuses(reachable, new Date(), "current")) {
    statuses[tenantId] = status;
  }
  return NextResponse.json({ statuses });
}
