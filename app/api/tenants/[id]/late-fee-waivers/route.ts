import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { statementForTenant } from "@/lib/statements";
import { waiverMonth } from "@/lib/late-fee-waiver";
import { unwaiveLateFee, waiveLateFee } from "@/lib/late-fee-waivers-db";

/**
 * Waive (POST {month, note?}) or take back (DELETE ?month=YYYY-MM) the late
 * fee for one month of one tenant. Both answer with the statement, worked
 * out afresh, which is what the statement panel shows next. Anyone on the
 * LLC's team may; see lib/late-fee-waivers-db.ts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const month = waiverMonth(body?.month);
  if (!month) return NextResponse.json({ error: "Pick a month." }, { status: 400 });

  const done = await waiveLateFee({
    userId,
    tenantId: id,
    month,
    note: typeof body?.note === "string" ? body.note : "",
  });
  if (!done) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await statementForTenant(id));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const month = waiverMonth(new URL(req.url).searchParams.get("month"));
  if (!month) return NextResponse.json({ error: "Pick a month." }, { status: 400 });

  const done = await unwaiveLateFee({ userId, tenantId: id, month });
  if (!done) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Not waived: nothing to take back, and the statement already says so.
  return NextResponse.json(await statementForTenant(id));
}
