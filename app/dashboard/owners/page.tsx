import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount } from "@/lib/requests";
import { companyOwnersSnapshot, type CompanyOwnersSnapshot } from "@/lib/owners-db";
import OwnersClient from "./OwnersClient";

/**
 * Property owners and investors who get a read-only view of some of an
 * LLC's properties. Only LLCs this person is an owner (admin) of are
 * listed — handing out access is an owner's call, as on the Team page.
 */
export default async function OwnersPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const openRepairs = await openRepairCount(userId);

  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    select: { companyId: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const snapshots: CompanyOwnersSnapshot[] = [];
  for (const m of memberships) {
    if (m.role !== "owner") continue;
    const s = await companyOwnersSnapshot(m.companyId);
    if (s) snapshots.push(s);
  }

  return <OwnersClient openRepairs={openRepairs} companies={snapshots} memberOnly={memberships.length - snapshots.length} />;
}
