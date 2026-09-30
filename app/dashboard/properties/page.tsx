import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { openRepairCount } from "@/lib/requests";
import { rentForMonth } from "@/lib/rent";
import { monthKeyOf } from "@/lib/rent";
import { rentTargetOf, unitIdsCountingToward } from "@/lib/rent-target";
import { daysLate, isoDay, dateFromISO, leaseStatus } from "@/lib/lease";
import { serializeTenant } from "@/lib/tenants";
import { balancesForTenants } from "@/lib/statements";
import { propertyStatus, type PlaceMonth } from "@/lib/property-status";
import PropertiesClient, { type PropertyRow } from "./PropertiesClient";

/**
 * Every property across the person's LLCs, as one sortable list — the
 * sidebar's "Properties". Each row's month is judged exactly as the
 * dashboard card judges it: per unit, rent for the month (after rent
 * changes) against rent logged for it, with the month's late fees counted as
 * owed and "late" meaning past the tenant's due day. Balance is the tenants'
 * statement balance, the figure the property page shows.
 */
export default async function PropertiesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const memberships = await prisma.companyMember.findMany({
    where: { userId: me.id },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);
  const roleOf = new Map(memberships.map((m) => [m.companyId, m.role]));

  // The dashboard's "today": the server's calendar day, and its month.
  const todayKey = isoDay(new Date());
  const now = dateFromISO(todayKey);
  const month = todayKey.slice(0, 7);
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const inCompanies = { property: { companyId: { in: companyIds } } };

  const [properties, units, tenants, rentChanges, rentTx, lastRent, entryCounts, lateFeeRows, openRepairs] =
    await Promise.all([
      prisma.property.findMany({ where: { companyId: { in: companyIds } }, orderBy: { name: "asc" } }),
      prisma.unit.findMany({ where: inCompanies, orderBy: { createdAt: "asc" } }),
      prisma.tenant.findMany({ where: { ...inCompanies, active: true }, orderBy: { createdAt: "asc" } }),
      prisma.rentChange.findMany({ where: inCompanies, orderBy: { effectiveFrom: "asc" } }),
      prisma.transaction.findMany({
        where: { ...inCompanies, type: "rent", date: { gte: monthStart, lt: nextMonthStart } },
        select: { propertyId: true, unitId: true, amount: true },
        orderBy: { date: "desc" },
      }),
      prisma.transaction.groupBy({ by: ["propertyId"], where: { ...inCompanies, type: "rent" }, _max: { date: true } }),
      // For the remove confirmation, which says how many ledger entries go with it.
      prisma.transaction.groupBy({ by: ["propertyId"], where: inCompanies, _count: { _all: true } }),
      // The same late fees the dashboard counts: those a late rule wrote.
      prisma.tenantCharge.groupBy({
        by: ["tenantId", "month"],
        where: { kind: "fee", rule: { kind: "late" }, month, tenant: { active: true, ...inCompanies } },
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
  const rentIn = new Map<string, number>();
  for (const t of rentTx) {
    const key = `${t.propertyId}|${t.unitId ?? ""}`;
    rentIn.set(key, (rentIn.get(key) ?? 0) + t.amount);
  }
  const lateFees = new Map(lateFeeRows.map((r) => [r.tenantId, Math.round((r._sum.amount ?? 0) * 100) / 100]));
  const lastPaid = new Map(lastRent.map((r) => [r.propertyId, r._max.date?.toISOString().slice(0, 10) ?? ""]));
  const entries = new Map(entryCounts.map((r) => [r.propertyId, r._count._all]));
  const balances = await balancesForTenants(tenants.map((t) => t.id));
  const tenantDTOs = tenants.map(serializeTenant);

  const rows: PropertyRow[] = properties.map((p) => {
    const propUnits = units.filter((u) => u.propertyId === p.id);
    const propTenants = tenantDTOs.filter((t) => t.propertyId === p.id);
    const targets = propUnits.length
      ? propUnits.map((u) => ({ unitId: u.id as string | null, monthlyRent: u.monthlyRent, vacant: u.vacant }))
      : [{ unitId: null as string | null, monthlyRent: p.monthlyRent, vacant: p.vacant }];

    const places: PlaceMonth[] = targets.map((t) => {
      const target = rentTargetOf(t.unitId, propUnits);
      const tenant = propTenants.find((x) => rentTargetOf(x.unitId ?? null, propUnits) === target) ?? null;
      const paid = unitIdsCountingToward(t.unitId, propUnits).reduce(
        (s, u) => s + (rentIn.get(`${p.id}|${u ?? ""}`) ?? 0),
        0
      );
      return {
        vacant: t.vacant,
        rent: rentForMonth(changes, p.id, t.unitId, month, t.monthlyRent),
        paid,
        fees: tenant ? lateFees.get(tenant.id) ?? 0 : 0,
        daysLate: tenant ? Math.max(0, daysLate(month, tenant.dueDay, now)) : 0,
        leaseEnded: Boolean(tenant && leaseStatus(tenant, now).kind === "expired"),
      };
    });

    const balance = propTenants.reduce((s, t) => s + (balances[t.id]?.balance ?? 0), 0);
    return {
      id: p.id,
      name: p.name,
      address: p.address ?? "",
      companyId: p.companyId,
      company: memberships.find((m) => m.companyId === p.companyId)?.company.name ?? "",
      tenants: propTenants.map((t) => t.name),
      units: targets.length,
      rent: places.reduce((s, x) => s + x.rent, 0),
      status: propertyStatus(places),
      balance: Math.round(balance * 100) / 100,
      lastPaid: lastPaid.get(p.id) ?? "",
      entries: entries.get(p.id) ?? 0,
      canRemove: roleOf.get(p.companyId) === "owner",
      // What the edit form starts from, as on the dashboard card.
      monthlyRent: p.monthlyRent,
      vacant: p.vacant,
    };
  });

  return (
    <PropertiesClient
      rows={rows}
      companies={memberships.map((m) => ({ id: m.company.id, name: m.company.name }))}
      openRepairs={openRepairs}
      userLabel={me.name || me.email || "you"}
    />
  );
}
