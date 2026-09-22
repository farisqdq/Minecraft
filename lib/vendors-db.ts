import { prisma } from "@/lib/prisma";
import { normalizeTrade, phoneProblem, type VendorDTO } from "@/lib/vendors";
import { emailProblem } from "@/lib/portal";

/**
 * Every vendor in the books of the given companies, with what you've used
 * them for — the numbers are the point of keeping a vendor book at all.
 */
export async function vendorsForCompanies(companyIds: string[], now = new Date()): Promise<VendorDTO[]> {
  if (companyIds.length === 0) return [];
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

  const [vendors, allTime, thisYear] = await Promise.all([
    prisma.vendor.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { repairs: true } },
        repairs: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
        transactions: { select: { date: true }, orderBy: { date: "desc" }, take: 1 },
      },
    }),
    prisma.transaction.groupBy({
      by: ["vendorId"],
      where: { vendorId: { not: null }, type: "expense", property: { companyId: { in: companyIds } } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["vendorId"],
      where: {
        vendorId: { not: null },
        type: "expense",
        date: { gte: yearStart },
        property: { companyId: { in: companyIds } },
      },
      _sum: { amount: true },
    }),
  ]);

  const sum = (rows: typeof allTime, id: string) =>
    Math.round((rows.find((r) => r.vendorId === id)?._sum.amount ?? 0) * 100) / 100;

  return vendors.map((v) => {
    const last = [v.repairs[0]?.createdAt, v.transactions[0]?.date]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: v.id,
      companyId: v.companyId,
      name: v.name,
      trade: normalizeTrade(v.trade),
      phone: v.phone ?? "",
      email: v.email ?? "",
      note: v.note ?? "",
      jobs: v._count.repairs,
      spent: sum(allTime, v.id),
      spentThisYear: sum(thisYear, v.id),
      lastUsed: last ? last.toISOString().slice(0, 10) : "",
    };
  });
}

/** Validates a vendor form. Shared by create and edit so they can't drift. */
export function readVendor(body: Record<string, unknown> | null) {
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (!name) return { error: "Who is it?" };
  const badPhone = phoneProblem(phone);
  if (badPhone) return { error: badPhone };
  if (email) {
    const badEmail = emailProblem(email);
    if (badEmail) return { error: badEmail };
  }
  return {
    data: {
      name,
      trade: normalizeTrade(body?.trade),
      phone: phone || null,
      email: email || null,
      note: note || null,
    },
  };
}
