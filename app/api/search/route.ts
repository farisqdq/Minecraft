import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";

/**
 * The index behind the search box in the header. It is deliberately small —
 * just the words someone might type and the id to jump to — because it is
 * fetched on every page, not only the dashboard, and the dashboard's own
 * property list carries far more than a search needs.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyIds = await companyIdsForUser(userId);
  if (companyIds.length === 0) return NextResponse.json([]);

  const properties = await prisma.property.findMany({
    where: { companyId: { in: companyIds } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      company: { select: { name: true } },
      units: { select: { name: true }, orderBy: { createdAt: "asc" } },
      // Someone searching by tenant is looking for where that person lives,
      // which the past tenants of the same house would only confuse.
      tenants: { where: { active: true }, select: { name: true } },
    },
  });

  return NextResponse.json(
    properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address ?? "",
      company: p.company.name,
      units: p.units.map((u) => u.name),
      tenants: p.tenants.map((t) => t.name),
    }))
  );
}
