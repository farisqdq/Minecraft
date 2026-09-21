import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { isoDay } from "@/lib/lease";
import { OPEN_STATUSES } from "@/lib/maintenance";
import { requestInclude, serializeRequest } from "@/lib/requests";
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

  const rows = requests.map(serializeRequest);

  return (
    <RepairsClient
      userLabel={me.name || me.email || "you"}
      serverToday={isoDay(new Date())}
      serverNow={new Date().toISOString()}
      initial={rows}
      openCount={rows.filter((r) => OPEN_STATUSES.includes(r.status)).length}
    />
  );
}
