import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { companyOwnersSnapshot } from "@/lib/owners-db";

/**
 * Who has owner-portal access to this LLC's properties, and who's been
 * invited. Company owners only: handing a stranger a read-only view of the
 * books is an owner's call, like inviting a teammate.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const snapshot = await companyOwnersSnapshot(id);
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(snapshot);
}
