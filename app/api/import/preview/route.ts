import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { parseRows, suggestionsFor } from "@/lib/bank-import-db";

/**
 * What each line of a statement probably is, for one LLC. Reads only; the
 * lines aren't stored until someone imports them.
 */
export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  if (!companyId || !(await requireCompany(userId, companyId))) {
    return NextResponse.json({ error: "LLC not found." }, { status: 404 });
  }
  const parsed = parseRows(body?.rows);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  return NextResponse.json({ suggestions: await suggestionsFor(companyId, parsed.rows) });
}
