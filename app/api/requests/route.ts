import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { requestInclude, serializeRequest } from "@/lib/requests";

/**
 * Every repair this landlord's team can see, in the order the queue shows
 * them. Used to re-draw the page when the pulse says something changed,
 * which is why it returns the same shape the server component renders with.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyIds = await companyIdsForUser(userId);
  const requests = await prisma.maintenanceRequest.findMany({
    where: { property: { companyId: { in: companyIds } } },
    include: requestInclude,
    orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(requests.map(serializeRequest));
}
