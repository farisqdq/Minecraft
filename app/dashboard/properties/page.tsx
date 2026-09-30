import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { openRepairCount } from "@/lib/requests";
import { monthKeyOf, rentForMonth } from "@/lib/rent";
import PropertiesClient, { type PropertyRow } from "./PropertiesClient";

/**
 * Every property across the person's LLCs, as one sortable list — the
 * sidebar's "Properties". The dashboard keeps its own property cards; this is
 * the index to jump from. Figures are this month's: what the occupied units
 * rent for, and what has come in against it.
 */
export default async function PropertiesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const companyIds = await companyIdsForUser(me.id);
  const now = new Date();
  const month = monthKeyOf(now);
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));

  const [properties, rentChanges, rentIn, openRepairs] = await Promise.all([
    prisma.property.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: { name: "asc" },
      include: {
        company: { select: { name: true } },
        units: { orderBy: { createdAt: "asc" } },
        tenants: { where: { active: true }, select: { id: true, unitId: true, dueDay: true } },
      },
    }),
    prisma.rentChange.findMany({ where: { property: { companyId: { in: companyIds } } } }),
    prisma.transaction.groupBy({
      by: ["propertyId"],
      where: { type: "rent", date: { gte: monthStart, lt: nextMonthStart }, property: { companyId: { in: companyIds } } },
      _sum: { amount: true },
    }),
    openRepairCount(me.id),
  ]);

  const changes = rentChanges.map((c) => ({
    id: c.id,
    propertyId: c.propertyId,
    unitId: c.unitId,
    effectiveFrom: monthKeyOf(c.effectiveFrom),
    amount: c.amount,
  }));
  const collectedBy = new Map(rentIn.map((r) => [r.propertyId, r._sum.amount ?? 0]));
  const today = now.getUTCDate();

  const rows: PropertyRow[] = properties.map((p) => {
    const places = p.units.length
      ? p.units.map((u) => ({ rent: rentForMonth(changes, p.id, u.id, month, u.monthlyRent), vacant: u.vacant }))
      : [{ rent: rentForMonth(changes, p.id, null, month, p.monthlyRent), vacant: p.vacant }];
    const occupied = places.filter((x) => !x.vacant);
    const expected = occupied.reduce((s, x) => s + x.rent, 0);
    const collected = Math.round((collectedBy.get(p.id) ?? 0) * 100) / 100;
    const firstDue = p.tenants.length ? Math.min(...p.tenants.map((t) => t.dueDay)) : 1;

    let status: PropertyRow["status"];
    if (!occupied.length) status = "vacant";
    else if (expected <= 0) status = "none";
    else if (collected >= expected - 0.005) status = "paid";
    else if (collected > 0) status = "partial";
    else status = today > firstDue ? "unpaid" : "due";

    return {
      id: p.id,
      name: p.name,
      address: p.address ?? "",
      company: p.company.name,
      units: places.length,
      occupied: occupied.length,
      expected,
      collected,
      status,
    };
  });

  return (
    <PropertiesClient
      rows={rows}
      month={month}
      showCompany={companyIds.length > 1}
      openRepairs={openRepairs}
      userLabel={me.name || me.email || "you"}
    />
  );
}
