import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { csvRow } from "@/lib/csv";
import { TAX_CLASS_LABEL, due1099, normalizeTaxClass, rows1099, threshold1099 } from "@/lib/tax1099";

/**
 * One LLC's 1099-NEC picture for a year: who it paid over the line, who is
 * exempt, whose W-9 is missing. JSON for the Export page; ?format=csv for
 * the accountant. The LLC is the payer, so each one is its own report.
 */
export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId") || "";
  const year = Number(url.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Choose a year." }, { status: 400 });
  }
  if (!companyId || !(await requireCompany(userId, companyId))) {
    return NextResponse.json({ error: "LLC not found." }, { status: 404 });
  }

  const [company, vendors, payments, w9s] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, name: true, taxClass: true } }),
    prisma.transaction.findMany({
      where: {
        type: "expense",
        vendorId: { not: null },
        property: { companyId },
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { vendorId: true, amount: true, category: true },
    }),
    prisma.document.findMany({
      where: { companyId, vendorId: { not: null }, kind: "W-9" },
      select: { vendorId: true },
    }),
  ]);

  const rows = rows1099(
    vendors.map((v) => ({ id: v.id, name: v.name, taxClass: normalizeTaxClass(v.taxClass) })),
    payments.map((p) => ({ vendorId: p.vendorId!, amount: p.amount, category: p.category ?? "" })),
    new Set(w9s.map((d) => d.vendorId!)),
    year
  );

  if (url.searchParams.get("format") !== "csv") {
    return NextResponse.json({ year, threshold: threshold1099(year), due: due1099(year), rows });
  }

  const STATUS = { file: "1099-NEC due", exempt: "Exempt (corporation)", check: "Check: tax class unknown", below: "Under the line" };
  const lines = [
    csvRow([`${company?.name ?? "LLC"} — 1099-NEC review for ${year}`]),
    csvRow([`Threshold $${threshold1099(year)}; due ${due1099(year)}. Payments by card or PayPal are reported on a 1099-K by the processor, not here. Not tax advice.`]),
    "\r\n",
    csvRow(["Vendor", "Tax class", "Paid in " + year, "Of which legal services", "W-9 on file", "Status", "Note"]),
    ...rows.map((r) =>
      csvRow([r.name, TAX_CLASS_LABEL[r.taxClass ?? ""], r.total, r.legal, r.w9 ? "Yes" : "No", STATUS[r.status], r.why])
    ),
  ];
  const name = `${(company?.name ?? "llc").replace(/[^A-Za-z0-9]+/g, "-")}-1099-${year}.csv`;
  return new NextResponse(lines.join(""), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
