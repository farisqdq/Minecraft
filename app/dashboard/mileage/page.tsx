import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasRole } from "@/lib/access";
import { openRepairCount } from "@/lib/requests";
import { isoDay } from "@/lib/lease";
import { serializeTrip } from "@/lib/trips-db";
import MileageClient from "./MileageClient";

/** The mileage log (a33): every drive to a rental, and what it's worth at tax time. */
export default async function MileagePage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const memberships = await prisma.companyMember.findMany({
    where: { userId: me.id },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);
  const writable = new Set(memberships.filter((m) => hasRole(m.role, "member")).map((m) => m.companyId));

  const [properties, trips, openRepairs] = await Promise.all([
    prisma.property.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true, name: true, companyId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.trip.findMany({
      where: { property: { companyId: { in: companyIds } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    openRepairCount(me.id),
  ]);

  const { property } = await searchParams;
  return (
    <MileageClient
      openRepairs={openRepairs}
      userLabel={me.name || me.email || "you"}
      today={isoDay(new Date())}
      companies={memberships.map((m) => m.company)}
      properties={properties.map((p) => ({ ...p, writable: writable.has(p.companyId) }))}
      initialTrips={trips.map(serializeTrip)}
      preselect={typeof property === "string" ? property : ""}
    />
  );
}
