import { prisma } from "@/lib/prisma";
import type { RequestDTO, RequestStatus, Urgency } from "@/lib/maintenance";

/** Everything both sides need to render a request, fetched the same way. */
export const requestInclude = {
  property: { select: { name: true } },
  unit: { select: { name: true } },
  tenant: { select: { name: true } },
  photos: { orderBy: { createdAt: "asc" } },
  updates: { orderBy: { createdAt: "asc" } },
} as const;

type Row = Awaited<ReturnType<typeof loadOne>>;

async function loadOne(id: string) {
  return prisma.maintenanceRequest.findUnique({ where: { id }, include: requestInclude });
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

export function serializeRequest(r: NonNullable<Row>): RequestDTO {
  return {
    id: r.id,
    propertyId: r.propertyId,
    propertyName: r.property.name,
    unitName: r.unit?.name ?? "",
    tenantName: r.tenant?.name ?? "",
    title: r.title,
    detail: r.detail,
    category: r.category,
    place: r.place ?? "",
    urgency: r.urgency as Urgency,
    status: r.status as RequestStatus,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    resolvedAt: iso(r.resolvedAt),
    loggedAsExpense: Boolean(r.transactionId),
    photos: r.photos.map((p) => ({
      id: p.id,
      url: p.url,
      filename: p.filename,
      contentType: p.contentType,
    })),
    updates: r.updates.map((u) => ({
      id: u.id,
      from: u.statusTo ? ("system" as const) : u.authorUserId ? ("landlord" as const) : ("tenant" as const),
      authorName: u.authorName,
      body: u.body,
      statusTo: (u.statusTo as RequestStatus) ?? null,
      createdAt: iso(u.createdAt),
    })),
  };
}

/**
 * A request the signed-in tenant actually reported.
 *
 * Scoped by tenantId from the session rather than by anything in the URL, so
 * a guessed id belonging to another tenant comes back null exactly as a
 * made-up one would.
 */
export async function requestForTenant(tenantId: string, requestId: string) {
  const row = await prisma.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: requestInclude,
  });
  return row && row.tenantId === tenantId ? row : null;
}

/** A request on a property the signed-in landlord's team can reach. */
export async function requestForUser(userId: string, requestId: string) {
  const row = await prisma.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: { ...requestInclude, property: { select: { name: true, companyId: true } } },
  });
  if (!row) return null;
  const membership = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: row.property.companyId, userId } },
  });
  return membership ? row : null;
}

/**
 * Append to the thread. A status change is a row too, so the tenant reads one
 * timeline rather than a conversation next to a separate history.
 */
export async function addUpdate(opts: {
  requestId: string;
  authorName: string;
  body: string;
  authorUserId?: string | null;
  authorTenantId?: string | null;
  statusTo?: RequestStatus | null;
}) {
  return prisma.maintenanceUpdate.create({
    data: {
      requestId: opts.requestId,
      authorName: opts.authorName,
      body: opts.body,
      authorUserId: opts.authorUserId ?? null,
      authorTenantId: opts.authorTenantId ?? null,
      statusTo: opts.statusTo ?? null,
    },
  });
}

/** How many repairs are still waiting on this landlord, for the nav badge. */
export async function openRepairCount(userId: string) {
  return prisma.maintenanceRequest.count({
    where: {
      status: { in: ["open", "seen", "scheduled"] },
      property: { company: { members: { some: { userId } } } },
    },
  });
}
