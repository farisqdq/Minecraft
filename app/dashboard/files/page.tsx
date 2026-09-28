import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { openRepairCount } from "@/lib/requests";
import { isoDay } from "@/lib/lease";
import { documentsWhere } from "@/lib/documents-db";
import { blobConfigured } from "@/lib/blob";
import FilingCabinet from "../../components/FilingCabinet";

/** Every document across the person's companies. */
export default async function FilesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const companyIds = await companyIdsForUser(me.id);
  const [documents, properties, tenants, ownerships, openRepairs] = await Promise.all([
    documentsWhere({ companyId: { in: companyIds } }),
    prisma.property.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, companyId: true, company: { select: { name: true } } },
    }),
    prisma.tenant.findMany({
      where: { property: { companyId: { in: companyIds } }, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, propertyId: true },
    }),
    prisma.companyMember.findMany({
      where: { userId: me.id, role: "owner" },
      select: { companyId: true },
    }),
    openRepairCount(me.id),
  ]);

  return (
    <FilingCabinet
      userLabel={me.name || me.email || "you"}
      openRepairs={openRepairs}
      initial={documents}
      properties={properties.map((p) => ({ id: p.id, name: p.name, companyId: p.companyId, companyName: p.company.name }))}
      tenants={tenants}
      ownerCompanyIds={ownerships.map((o) => o.companyId)}
      today={isoDay(new Date())}
      storageReady={blobConfigured()}
    />
  );
}
