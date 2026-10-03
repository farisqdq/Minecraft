import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { openRepairCount } from "@/lib/requests";
import { serializeApplication, serializeListing } from "@/lib/listings-db";
import { fileLink } from "@/lib/file-links";
import { isoDay } from "@/lib/lease";
import ListingsClient from "./ListingsClient";

/** Every listing on the user's LLCs, and who has applied (a27). */
export default async function ListingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const memberships = await prisma.companyMember.findMany({ where: { userId: me.id }, select: { companyId: true, role: true } });
  const companyIds = memberships.map((m) => m.companyId);

  const [listings, openRepairs] = await Promise.all([
    prisma.listing.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: [{ open: "desc" }, { createdAt: "desc" }],
      include: {
        applications: { orderBy: { createdAt: "desc" } },
        property: { select: { name: true, monthlyRent: true } },
        unit: { select: { name: true, monthlyRent: true } },
      },
    }),
    openRepairCount(me.id),
  ]);
  const propertyIds = [...new Set(listings.map((l) => l.propertyId))];
  const photos = await prisma.document.findMany({
    where: { propertyId: { in: propertyIds }, kind: "Photo" },
    orderBy: { createdAt: "asc" },
    select: { id: true, propertyId: true, title: true },
  });

  return (
    <ListingsClient
      openRepairs={openRepairs}
      serverToday={isoDay(new Date())}
      ownerOf={memberships.filter((m) => m.role === "owner").map((m) => m.companyId)}
      initial={listings.map((l) => ({
        listing: serializeListing(l),
        place: l.unit ? `${l.property.name} — ${l.unit.name}` : l.property.name,
        applications: l.applications.map(serializeApplication),
      }))}
      photos={Object.fromEntries(
        propertyIds.map((pid) => [
          pid,
          photos.filter((p) => p.propertyId === pid).map((p) => ({ id: p.id, url: fileLink("document", p.id), title: p.title })),
        ])
      )}
    />
  );
}
