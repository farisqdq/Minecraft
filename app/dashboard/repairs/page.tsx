import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { isoDay } from "@/lib/lease";
import { OPEN_STATUSES } from "@/lib/maintenance";
import { requestInclude, serializeRequestForLandlord } from "@/lib/requests";
import { vendorsForCompanies } from "@/lib/vendors-db";
import RepairsClient from "./RepairsClient";

export default async function RepairsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const companyIds = await companyIdsForUser(me.id);
  const requests = await prisma.maintenanceRequest.findMany({
    where: { property: { companyId: { in: companyIds } } },
    include: requestInclude,
    // Urgent before normal, then oldest first inside each — the thing that has
    // been waiting longest is the thing most likely to have gone wrong.
    orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
  });

  const rows = requests.map(serializeRequestForLandlord);
  const [vendors, properties] = await Promise.all([
    vendorsForCompanies(companyIds),
    prisma.property.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true, companyId: true },
    }),
  ]);

  return (
    <RepairsClient
      userLabel={me.name || me.email || "you"}
      serverToday={isoDay(new Date())}
      serverNow={new Date().toISOString()}
      initial={rows}
      openCount={rows.filter((r) => OPEN_STATUSES.includes(r.status)).length}
      vendors={vendors}
      companyOf={Object.fromEntries(properties.map((p) => [p.id, p.companyId]))}
    />
  );
}
