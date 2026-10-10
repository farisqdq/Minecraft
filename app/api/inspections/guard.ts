import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { requireInspection, type Role } from "@/lib/access";
import { lockedMessage } from "@/lib/inspections-db";

type Found = NonNullable<Awaited<ReturnType<typeof requireInspection>>>;

/**
 * The checks every inspection write starts with: signed in, on the team
 * (member or above unless `role` says otherwise), and — for anything that
 * changes what the report says — not yet acknowledged by the tenant.
 */
export async function inspectionFor(
  id: string,
  opts: { role?: Role; unlocked?: boolean } = {}
): Promise<{ ok: true; me: { id: string; name: string; email: string }; inspection: Found } | { ok: false; res: NextResponse }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const found = await requireInspection(me.id, id);
  if (!found) return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (opts.role && opts.role !== "member" && !(await requireInspection(me.id, id, opts.role))) {
    return { ok: false, res: NextResponse.json({ error: "Only an owner of this LLC can do that." }, { status: 403 }) };
  }
  if (opts.unlocked !== false && found.acknowledgedAt) {
    return { ok: false, res: NextResponse.json({ error: lockedMessage(found.acknowledgedAt) }, { status: 409 }) };
  }
  return { ok: true, me, inspection: found };
}
