import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { openRepairCount } from "@/lib/requests";
import { isoDay } from "@/lib/lease";
import { documentsWhere } from "@/lib/documents-db";
import { blobConfigured } from "@/lib/blob";
import FilingCabinet from "../../../../components/FilingCabinet";

/** One property's drawer of the filing cabinet: its documents and its tenants'. */
export default async function PropertyFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const { id } = await params;
  const property = await requireProperty(me.id, id);
  if (!property) notFound();

  const [documents, company, tenants, membership, openRepairs] = await Promise.all([
    documentsWhere({ propertyId: property.id }),
    prisma.company.findUnique({ where: { id: property.companyId }, select: { name: true } }),
    prisma.tenant.findMany({
      where: { propertyId: property.id, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, propertyId: true },
    }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId: property.companyId, userId: me.id } },
      select: { role: true },
    }),
    openRepairCount(me.id),
  ]);

  const here = { id: property.id, name: property.name, companyId: property.companyId, companyName: company?.name ?? "" };
  return (
    <FilingCabinet
      userLabel={me.name || me.email || "you"}
      openRepairs={openRepairs}
      initial={documents}
      properties={[here]}
      tenants={tenants}
      ownerCompanyIds={membership?.role === "owner" ? [property.companyId] : []}
      property={here}
      today={isoDay(new Date())}
      storageReady={blobConfigured()}
    />
  );
}
