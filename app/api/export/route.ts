import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { csvRow } from "@/lib/csv";
import { balanceAt, yearTotals } from "@/lib/loans";

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

  // Schedule E is filled in per property — a column each — so the summary
  // below carries the same breakdown rather than only an LLC-wide total.
  type PropertyTotals = { rent: number; expenses: Map<string, number>; expenseTotal: number };
  const byProperty = new Map<string, PropertyTotals>();
  const propertyFor = (name: string) => {
    let totals = byProperty.get(name);
    if (!totals) {
      totals = { rent: 0, expenses: new Map(), expenseTotal: 0 };
      byProperty.set(name, totals);
    }
    return totals;
  };

  for (const t of transactions) {
    const isRent = t.type === "rent";
    const totals = propertyFor(t.property.name);
    if (isRent) {
      rentTotal += t.amount;
      totals.rent += t.amount;
    } else {
      const cat = t.category || "Uncategorized";
      expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + t.amount);
      expenseTotal += t.amount;
      totals.expenses.set(cat, (totals.expenses.get(cat) ?? 0) + t.amount);
      totals.expenseTotal += t.amount;
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

  // Per-property columns, in the order they appear in the ledger. A category
  // row is included when any property used it, so the columns line up.
  const propertyNames = [...byProperty.keys()];
  if (propertyNames.length > 1) {
    const usedCategories = [...EXPENSE_CATEGORIES, "Uncategorized"].filter((c) =>
      propertyNames.some((n) => byProperty.get(n)!.expenses.get(c))
    );

    rows.push("\r\n");
    rows.push(csvRow(["By property", String(year), ...propertyNames]));
    rows.push(csvRow(["Rental Income", "", ...propertyNames.map((n) => fmt(byProperty.get(n)!.rent))]));
    for (const category of usedCategories) {
      rows.push(
        csvRow([
          category,
          "",
          ...propertyNames.map((n) => fmt(-(byProperty.get(n)!.expenses.get(category) ?? 0))),
        ])
      );
    }
    rows.push(
      csvRow(["Total Expenses", "", ...propertyNames.map((n) => fmt(-byProperty.get(n)!.expenseTotal))])
    );
    rows.push(
      csvRow([
        "Net Profit",
        "",
        ...propertyNames.map((n) => {
          const totals = byProperty.get(n)!;
          return fmt(totals.rent - totals.expenseTotal);
        }),
      ])
    );
  }

  // Mortgages: the interest above should match box 1 of each lender's Form
  // 1098, and the principal is listed so it's plain it was never counted as
  // an expense. Loans with no payment this year are left out.
  const loans = await prisma.loan.findMany({
    where: { property: { companyId } },
    include: { property: { select: { name: true } }, payments: true },
    orderBy: { createdAt: "asc" },
  });
  const loanRows = loans
    .map((l) => ({ l, totals: yearTotals(l.payments, year) }))
    .filter(({ totals }) => totals.count > 0);
  if (loanRows.length > 0) {
    rows.push("\r\n");
    rows.push(
      csvRow([
        "Mortgages",
        String(year),
        "Property",
        "Payments",
        "Interest (check against Form 1098)",
        "Escrow",
        "Principal (not an expense)",
        "Balance at year end",
      ])
    );
    for (const { l, totals } of loanRows) {
      rows.push(
        csvRow([
          l.lender,
          "",
          l.property.name,
          String(totals.count),
          fmt(totals.interest),
          fmt(totals.escrow),
          fmt(totals.principal),
          fmt(balanceAt(l.balance, l.payments, `${year}-12`)),
        ])
      );
    }
  }

  const safeName = company.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(rows.join(""), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-${year}.csv"`,
    },
  });
}
