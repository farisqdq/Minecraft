import { NextResponse } from "next/server";
import { requireOwnerSession } from "@/lib/owner-access";
import { ownerStatements } from "@/lib/owners-db";
import { isMonthKey, monthKeyOf, shiftMonth } from "@/lib/owners";
import { ownerStatementPdf } from "@/lib/owner-statement-pdf";
import { formatDay, isoDay } from "@/lib/lease";

/**
 * The month's statement as a PDF: /api/owners/statement?month=YYYY-MM.
 * Scoped by the session — the properties in it are the owner's and no
 * others, whatever the query string says.
 */
export async function GET(req: Request) {
  const me = await requireOwnerSession();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wanted = new URL(req.url).searchParams.get("month");
  const month = isMonthKey(wanted) ? wanted : shiftMonth(monthKeyOf(new Date()), -1);

  const { properties, combined } = await ownerStatements(me.properties, month);
  const bytes = ownerStatementPdf({
    ownerName: me.name,
    month,
    producedOn: formatDay(isoDay(new Date())),
    created: new Date(),
    properties: properties.map((p) => ({ name: p.name, address: p.address, companyName: p.companyName, statement: p.statement })),
    combined,
  });

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="owner-statement-${month}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
