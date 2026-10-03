import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { importChoices } from "@/lib/bank-import-db";

/**
 * Books the statement lines someone chose. Any member of the LLC may — the
 * same people who can record rent and expenses one at a time.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  if (!companyId || !(await requireCompany(userId, companyId))) {
    return NextResponse.json({ error: "LLC not found." }, { status: 404 });
  }
  const result = await importChoices(userId, companyId, body?.rows);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
