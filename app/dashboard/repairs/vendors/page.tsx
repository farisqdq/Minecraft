import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { openRepairCount } from "@/lib/requests";
import { vendorsForCompanies } from "@/lib/vendors-db";
import VendorsClient from "./VendorsClient";

export default async function VendorsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const companyIds = await companyIdsForUser(me.id);
  const [companies, vendors, openRepairs, owned] = await Promise.all([
    prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    vendorsForCompanies(companyIds),
    openRepairCount(me.id),
    prisma.companyMember.findMany({
      where: { userId: me.id, role: "owner" },
      select: { companyId: true },
    }),
  ]);

  return (
    <VendorsClient
      companies={companies}
      initial={vendors}
      openRepairs={openRepairs}
      ownerOf={owned.map((o) => o.companyId)}
    />
  );
}
