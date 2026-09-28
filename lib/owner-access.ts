import { prisma } from "@/lib/prisma";
import { getCurrentOwnerSession } from "@/lib/session";

/**
 * Everything an owner portal page is allowed to know, resolved from the
 * session on every request: who is signed in and which properties they may
 * read. It is the owner-side counterpart of requireTenantSession.
 *
 * Nothing here is taken from the URL. Every owner route filters by the
 * property ids this returns — a query is scoped with `propertyId: { in:
 * me.propertyIds }` and nothing else — so there is no id to tamper with.
 */
export type OwnerSession = NonNullable<Awaited<ReturnType<typeof requireOwnerSession>>>;

export async function requireOwnerSession() {
  const current = await getCurrentOwnerSession();
  if (!current) return null;

  const owner = await prisma.propertyOwner.findUnique({
    where: { id: current.ownerId },
    include: {
      access: {
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              companyId: true,
              company: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!owner) return null;
  // Signed out everywhere since this token was issued, or never given a
  // password (restored from a backup) — either way the token is stale.
  if (owner.sessionVersion !== current.sv || !owner.passwordHash) return null;

  const properties = owner.access.map((a) => ({
    id: a.property.id,
    name: a.property.name,
    address: a.property.address ?? "",
    companyId: a.property.companyId,
    companyName: a.property.company.name,
  }));

  return {
    ownerId: owner.id,
    email: owner.email,
    name: owner.name,
    monthlyEmail: owner.monthlyEmail,
    properties,
    propertyIds: properties.map((p) => p.id),
  };
}
