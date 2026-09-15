import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { csvRow } from "@/lib/csv";

const fmt = (n: number) => n.toFixed(2);

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId") || "";
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  const membership = await requireCompany(userId, companyId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const transactions = await prisma.transaction.findMany({
    where: { property: { companyId }, date: { gte: start, lt: end } },
    include: { property: { select: { name: true } }, unit: { select: { name: true } } },
    orderBy: { date: "asc" },
  });

  const rows: string[] = [];
  rows.push(csvRow(["Date", "Property", "Unit", "Type", "Category", "Description", "Note", "Amount"]));

  let rentTotal = 0;
  const expenseByCategory = new Map<string, number>();
  let expenseTotal = 0;

  for (const t of transactions) {
    const isRent = t.type === "rent";
    if (isRent) rentTotal += t.amount;
    else {
      const cat = t.category || "Uncategorized";
      expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + t.amount);
      expenseTotal += t.amount;
    }
    rows.push(
      csvRow([
        t.date.toISOString().slice(0, 10),
        t.property.name,
        t.unit?.name ?? "",
        isRent ? "Rent" : "Expense",
        isRent ? "" : t.category || "Uncategorized",
        t.detail ?? "",
        t.note ?? "",
        isRent ? fmt(t.amount) : fmt(-t.amount),
      ])
    );
  }

  rows.push("\r\n");
  rows.push(csvRow(["Summary", String(year)]));
  rows.push(csvRow(["Rental Income", fmt(rentTotal)]));
  for (const category of [...EXPENSE_CATEGORIES, "Uncategorized"]) {
    const total = expenseByCategory.get(category);
    if (total) rows.push(csvRow([category, fmt(-total)]));
  }
  rows.push(csvRow(["Total Expenses", fmt(-expenseTotal)]));
  rows.push(csvRow(["Net Profit", fmt(rentTotal - expenseTotal)]));

  const safeName = company.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(rows.join(""), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-${year}.csv"`,
    },
  });
}
