import { prisma } from "@/lib/prisma";
import { companyIdsForUser } from "@/lib/access";
import { landlordUnreadByThread } from "@/lib/messages-db";
import { expiringDocuments } from "@/lib/documents-db";
import { SOON_DAYS } from "@/lib/documents";
import { sortNotifications, type NotificationItem } from "@/lib/notifications";

/** How far ahead a lease ending shows up. */
export const LEASE_SOON_DAYS = 60;

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const place = (property: string, unit?: string | null) => [property, unit].filter(Boolean).join(" — ");
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/**
 * Everything waiting on this landlord, across every LLC they're on (see
 * lib/notifications.ts). Five small queries, run together.
 */
export async function notificationsFor(userId: string, now = new Date()): Promise<NotificationItem[]> {
  const companyIds = await companyIdsForUser(userId);
  if (companyIds.length === 0) return [];
  const inCompanies = { companyId: { in: companyIds } };

  const [applications, unread, repairs, documents, leases] = await Promise.all([
    // New applications: not yet reviewed, approved or declined.
    prisma.rentalApplication.findMany({
      where: { status: "new", listing: inCompanies },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        income: true,
        moveIn: true,
        listing: { select: { property: { select: { name: true } }, unit: { select: { name: true } } } },
      },
    }),
    landlordUnreadByThread({ company: { members: { some: { userId } } } }).then(async (counts) => {
      if (counts.size === 0) return [];
      const threads = await prisma.messageThread.findMany({
        where: { id: { in: [...counts.keys()] } },
        select: {
          id: true,
          tenantId: true,
          lastMessageAt: true,
          tenant: { select: { name: true, property: { select: { name: true } }, unit: { select: { name: true } } } },
          messages: { where: { fromTenant: true }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
        },
      });
      return threads.map((t) => ({ ...t, unread: counts.get(t.id) ?? 0 }));
    }),
    // Repairs nobody has looked at yet. Once seen they live on Repairs.
    prisma.maintenanceRequest.findMany({
      where: { status: "open", property: inCompanies },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        urgency: true,
        createdAt: true,
        property: { select: { name: true } },
        unit: { select: { name: true } },
        tenant: { select: { name: true } },
      },
    }),
    expiringDocuments(companyIds, new Date(now.getTime() + (SOON_DAYS + 1) * DAY)),
    prisma.tenant.findMany({
      where: {
        active: true,
        property: inCompanies,
        leaseEnd: { not: null, lte: new Date(now.getTime() + LEASE_SOON_DAYS * DAY) },
      },
      orderBy: { leaseEnd: "asc" },
      select: {
        id: true,
        name: true,
        leaseEnd: true,
        propertyId: true,
        property: { select: { name: true } },
        unit: { select: { name: true } },
      },
    }),
  ]);

  const today = day(now);
  const items: NotificationItem[] = [];

  for (const a of applications) {
    const bits = [place(a.listing.property.name, a.listing.unit?.name)];
    if (a.income) bits.push(`income ${money(a.income)}/mo`);
    if (a.moveIn) bits.push(`move-in ${day(a.moveIn)}`);
    items.push({
      id: `application:${a.id}`,
      kind: "application",
      title: `New application from ${a.name}`,
      detail: bits.join(" · "),
      at: a.createdAt.toISOString(),
      href: "/dashboard/listings",
      action: true,
    });
  }

  for (const t of unread) {
    const preview = t.messages[0]?.body?.replace(/\s+/g, " ").trim() ?? "";
    items.push({
      id: `message:${t.id}`,
      kind: "message",
      title: `${t.unread} new message${t.unread === 1 ? "" : "s"} from ${t.tenant.name}`,
      detail: [place(t.tenant.property.name, t.tenant.unit?.name), preview.length > 90 ? `${preview.slice(0, 90)}…` : preview]
        .filter(Boolean)
        .join(" · "),
      at: t.lastMessageAt.toISOString(),
      href: `/dashboard/messages/${t.tenantId}`,
      action: true,
    });
  }

  for (const r of repairs) {
    items.push({
      id: `repair:${r.id}`,
      kind: "repair",
      title: `${r.urgency === "urgent" ? "Urgent repair" : "Repair request"}: ${r.title}`,
      detail: [place(r.property.name, r.unit?.name), r.tenant ? `from ${r.tenant.name}` : ""].filter(Boolean).join(" · "),
      at: r.createdAt.toISOString(),
      href: "/dashboard/repairs",
      action: true,
      urgent: r.urgency === "urgent",
    });
  }

  for (const d of documents) {
    if (!d.expiresOn) continue;
    const on = d.expiresOn.slice(0, 10);
    const expired = on < today;
    items.push({
      id: `document:${d.id}`,
      kind: "document",
      title: `${d.title} ${expired ? "expired" : "expires"} ${on}`,
      detail: [d.ownerLabel, d.kind].filter(Boolean).join(" · "),
      at: on,
      href: d.propertyId ? `/dashboard/properties/${d.propertyId}/files` : "/dashboard/files",
      action: expired,
    });
  }

  for (const t of leases) {
    if (!t.leaseEnd) continue;
    const on = day(t.leaseEnd);
    const ended = on < today;
    items.push({
      id: `lease:${t.id}`,
      kind: "lease",
      title: `${t.name}'s lease ${ended ? "ended" : "ends"} ${on}`,
      detail: place(t.property.name, t.unit?.name),
      at: on,
      href: `/dashboard/properties/${t.propertyId}`,
      action: false,
    });
  }

  return sortNotifications(items);
}
