import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";

export const BACKUP_FORMAT = "rent-roll-backup";
export const BACKUP_VERSION = 1;

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyIds = await companyIdsForUser(userId);
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    include: {
      properties: {
        orderBy: { createdAt: "asc" },
        include: { transactions: { orderBy: { date: "asc" } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    companies: companies.map((c) => ({
      name: c.name,
      properties: c.properties.map((p) => ({
        name: p.name,
        address: p.address ?? "",
        monthlyRent: p.monthlyRent,
        transactions: p.transactions.map((t) => ({
          type: t.type,
          date: t.date.toISOString().slice(0, 10),
          amount: t.amount,
          detail: t.detail ?? "",
          note: t.note ?? "",
        })),
      })),
    })),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rent-roll-backup-${stamp}.json"`,
    },
  });
}
