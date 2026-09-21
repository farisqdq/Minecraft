import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * A short signature of "everything about these repairs right now".
 *
 * Counts as well as newest timestamps, because a deleted message moves no
 * timestamp forward — without the counts, the landlord clearing a line off a
 * thread would never reach the tenant's open page.
 *
 * Two aggregates, no rows returned, so this is cheap enough to ask for every
 * few seconds.
 */
export async function repairPulse(scope: Prisma.MaintenanceRequestWhereInput): Promise<string> {
  const [requests, updates] = await Promise.all([
    prisma.maintenanceRequest.aggregate({
      where: scope,
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.maintenanceUpdate.aggregate({
      where: { request: scope },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);

  return [
    requests._count._all,
    requests._max.updatedAt?.getTime() ?? 0,
    updates._count._all,
    updates._max.createdAt?.getTime() ?? 0,
  ].join(".");
}
