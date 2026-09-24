import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany, requireProperty } from "@/lib/access";
import { requireTenantSession } from "@/lib/tenant-access";
import type { FileKind } from "@/lib/file-links";

export type ViewableFile = { url: string; filename: string };

/**
 * The file behind /api/files/<kind>/<id>, if whoever is signed in may see it.
 *
 *   attachment — a receipt on a ledger entry: the landlord team for that
 *                property. Tenants never.
 *   photo      — a repair photo: the landlord team for that property, or the
 *                tenant who filed the report.
 *   document   — the landlord team for that LLC, or the tenant it's filed
 *                under, and only once it's been shared with them.
 *
 * Every refusal is the same null, so a stranger can't tell a file that
 * exists from one that doesn't.
 */
export async function viewableFile(kind: string, id: string): Promise<ViewableFile | null> {
  if (!id || id.length > 64) return null;
  const userId = await getCurrentUserId();
  const tenant = userId ? null : await requireTenantSession();
  if (!userId && !tenant) return null;

  switch (kind as FileKind) {
    case "attachment": {
      if (!userId) return null;
      const a = await prisma.attachment.findUnique({
        where: { id },
        select: { url: true, filename: true, transaction: { select: { propertyId: true } } },
      });
      if (!a || !(await requireProperty(userId, a.transaction.propertyId))) return null;
      return { url: a.url, filename: a.filename };
    }
    case "photo": {
      const p = await prisma.maintenancePhoto.findUnique({
        where: { id },
        select: {
          url: true,
          filename: true,
          request: { select: { tenantId: true, property: { select: { companyId: true } } } },
        },
      });
      if (!p) return null;
      const allowed = userId
        ? await requireCompany(userId, p.request.property.companyId)
        : p.request.tenantId === tenant!.tenant.id;
      return allowed ? { url: p.url, filename: p.filename } : null;
    }
    case "document": {
      const d = await prisma.document.findUnique({
        where: { id },
        select: { url: true, filename: true, companyId: true, tenantId: true, shared: true },
      });
      if (!d) return null;
      const allowed = userId
        ? await requireCompany(userId, d.companyId)
        : d.shared && d.tenantId === tenant!.tenant.id;
      return allowed ? { url: d.url, filename: d.filename } : null;
    }
    default:
      return null;
  }
}
