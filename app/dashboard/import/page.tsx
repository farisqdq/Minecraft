import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount } from "@/lib/requests";
import ImportClient, { type ImportCompany } from "./ImportClient";

export default async function ImportPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const openRepairs = await openRepairCount(userId);
  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);
  const [properties, units, tenants] = await Promise.all([
    prisma.property.findMany({ where: { companyId: { in: companyIds } }, orderBy: { createdAt: "asc" } }),
    prisma.unit.findMany({ where: { property: { companyId: { in: companyIds } } }, orderBy: { createdAt: "asc" } }),
    prisma.tenant.findMany({
      where: { property: { companyId: { in: companyIds } }, active: true },
      select: { name: true, propertyId: true, unitId: true },
    }),
  ]);

  // Every place a line can be filed against, the way the record form lists
  // them: a house, or each unit of a building and the building as a whole.
  const companies: ImportCompany[] = memberships.map((m) => ({
    id: m.company.id,
    name: m.company.name,
    places: properties
      .filter((p) => p.companyId === m.companyId)
      .flatMap((p) => {
        const own = units.filter((u) => u.propertyId === p.id);
        if (own.length === 0) return [{ key: `${p.id}|`, propertyId: p.id, unitId: null, label: p.name }];
        return [
          ...own.map((u) => ({ key: `${p.id}|${u.id}`, propertyId: p.id, unitId: u.id, label: `${p.name} — ${u.name}` })),
          { key: `${p.id}|`, propertyId: p.id, unitId: null, label: `${p.name} — (whole building)` },
        ];
      }),
  }));

  // Who lives where, so choosing a place for a rent line fills in the name.
  // Only a place with exactly one current tenant gets one.
  const counts = new Map<string, { name: string; n: number }>();
  for (const t of tenants) {
    const key = `${t.propertyId}|${t.unitId ?? ""}`;
    const seen = counts.get(key);
    counts.set(key, { name: t.name, n: (seen?.n ?? 0) + 1 });
  }
  const tenantAt = Object.fromEntries([...counts].filter(([, v]) => v.n === 1).map(([k, v]) => [k, v.name]));

  return <ImportClient openRepairs={openRepairs} companies={companies} tenantAt={tenantAt} />;
}
