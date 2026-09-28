import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { runLateFeesForCompany } from "@/lib/late-fees-db";

export const maxDuration = 60;

/**
 * "Run late fees now": apply the LLC's late fees to every tenant this minute
 * and say, tenant by tenant, what was charged or why nothing was. It only
 * applies rules that are already in force — the same thing opening a
 * tenant's statement does — and never charges anything twice.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireCompany(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ report: await runLateFeesForCompany(id) });
}
