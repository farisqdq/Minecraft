import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { normalizeKind, type DocumentDTO } from "@/lib/documents";
import { fileLink } from "@/lib/file-links";

export const documentInclude = {
  property: { select: { name: true } },
  tenant: { select: { name: true } },
  vendor: { select: { name: true } },
} as const;

type Row = Prisma.DocumentGetPayload<{ include: typeof documentInclude }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export function serializeDocument(d: Row): DocumentDTO {
  return {
    id: d.id,
    companyId: d.companyId,
    propertyId: d.propertyId ?? "",
    tenantId: d.tenantId ?? "",
    vendorId: d.vendorId ?? "",
    ownerLabel: d.tenant?.name ?? d.vendor?.name ?? d.property?.name ?? "The LLC",
    title: d.title,
    kind: normalizeKind(d.kind),
    // Never the storage URL: /api/files checks who is asking first.
    url: fileLink("document", d.id),
    filename: d.filename,
    contentType: d.contentType,
    size: d.size,
    expiresOn: day(d.expiresOn),
    note: d.note ?? "",
    shared: d.shared,
    createdAt: d.createdAt.toISOString(),
  };
}

export async function documentsWhere(where: Prisma.DocumentWhereInput) {
  const rows = await prisma.document.findMany({
    where,
    include: documentInclude,
    orderBy: [{ expiresOn: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeDocument);
}

/**
 * Documents running out by `until`, or already run out, across companies —
 * for the dashboard. Already-expired ones stay on the list until someone
 * uploads the new one or clears the date; forgetting about a lapsed
 * insurance certificate is exactly the failure this exists to prevent.
 */
export async function expiringDocuments(companyIds: string[], until: Date) {
  if (companyIds.length === 0) return [];
  return documentsWhere({
    companyId: { in: companyIds },
    expiresOn: { not: null, lte: until },
    // A document for a tenant who has moved out has stopped mattering.
    OR: [{ tenantId: null }, { tenant: { active: true } }],
  });
}

/** "2026-09-30" → that day at UTC midnight, or null for blank or nonsense. */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
