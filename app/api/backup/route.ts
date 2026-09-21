import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";

export const BACKUP_FORMAT = "rent-roll-backup";
export const BACKUP_VERSION = 5;

type TxnRow = {
  type: string;
  date: Date;
  amount: number;
  detail: string | null;
  note: string | null;
  category: string | null;
  attachments: { url: string; filename: string; contentType: string; size: number }[];
};

function serializeTxns(txns: TxnRow[]) {
  return txns.map((t) => ({
    type: t.type,
    date: t.date.toISOString().slice(0, 10),
    amount: t.amount,
    detail: t.detail ?? "",
    note: t.note ?? "",
    category: t.category ?? "",
    // Links to the stored files, not the files themselves — they stay in
    // blob storage and keep working as long as the app does.
    attachments: t.attachments.map((a) => ({
      url: a.url,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
  }));
}

type RecurringRow = {
  category: string;
  detail: string | null;
  note: string | null;
  amount: number;
  frequency: string;
  day: number;
  month: number | null;
  active: boolean;
};

function serializeRecurring(rows: RecurringRow[]) {
  return rows.map((r) => ({
    category: r.category,
    detail: r.detail ?? "",
    note: r.note ?? "",
    amount: r.amount,
    frequency: r.frequency,
    day: r.day,
    month: r.month,
    active: r.active,
  }));
}

type TenantRow = {
  name: string;
  email: string | null;
  phone: string | null;
  leaseStart: Date | null;
  leaseEnd: Date | null;
  deposit: number;
  dueDay: number;
  active: boolean;
  note: string | null;
};

function serializeTenants(rows: TenantRow[]) {
  return rows.map((t) => ({
    name: t.name,
    email: t.email ?? "",
    phone: t.phone ?? "",
    leaseStart: t.leaseStart ? t.leaseStart.toISOString().slice(0, 10) : "",
    leaseEnd: t.leaseEnd ? t.leaseEnd.toISOString().slice(0, 10) : "",
    deposit: t.deposit,
    dueDay: t.dueDay,
    active: t.active,
    note: t.note ?? "",
  }));
}

function serializeRentChanges(rows: { effectiveFrom: Date; amount: number }[]) {
  return rows.map((c) => ({
    effectiveFrom: c.effectiveFrom.toISOString().slice(0, 10),
    amount: c.amount,
  }));
}

type RequestRow = {
  title: string;
  detail: string;
  category: string;
  place: string | null;
  urgency: string;
  status: string;
  createdAt: Date;
  seenAt: Date | null;
  resolvedAt: Date | null;
  tenant: { name: string } | null;
  photos: { url: string; filename: string; contentType: string; size: number }[];
  updates: { authorName: string; body: string; statusTo: string | null; createdAt: Date }[];
};

/**
 * Repairs go out with the thread and the photo links, but the tenant is
 * carried as a name rather than an id: ids don't survive a restore into a
 * fresh database, and the name is what re-links it to the tenant row that
 * comes back alongside it.
 */
function serializeRequests(rows: RequestRow[]) {
  return rows.map((r) => ({
    title: r.title,
    detail: r.detail,
    category: r.category,
    place: r.place ?? "",
    urgency: r.urgency,
    status: r.status,
    tenantName: r.tenant?.name ?? "",
    createdAt: r.createdAt.toISOString(),
    seenAt: r.seenAt ? r.seenAt.toISOString() : "",
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : "",
    photos: r.photos.map((p) => ({
      url: p.url,
      filename: p.filename,
      contentType: p.contentType,
      size: p.size,
    })),
    updates: r.updates.map((u) => ({
      authorName: u.authorName,
      body: u.body,
      statusTo: u.statusTo ?? "",
      createdAt: u.createdAt.toISOString(),
    })),
  }));
}

const REQUEST_INCLUDE = {
  orderBy: { createdAt: "asc" },
  include: {
    tenant: { select: { name: true } },
    photos: { orderBy: { createdAt: "asc" } },
    updates: { orderBy: { createdAt: "asc" } },
  },
} as const;

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyIds = await companyIdsForUser(userId);
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    include: {
      properties: {
        orderBy: { createdAt: "asc" },
        include: {
          transactions: {
            where: { unitId: null },
            orderBy: { date: "asc" },
            include: { attachments: { orderBy: { createdAt: "asc" } } },
          },
          recurringExpenses: { where: { unitId: null }, orderBy: { createdAt: "asc" } },
          tenants: { where: { unitId: null }, orderBy: { createdAt: "asc" } },
          rentChanges: { where: { unitId: null }, orderBy: { effectiveFrom: "asc" } },
          requests: { ...REQUEST_INCLUDE, where: { unitId: null } },
          units: {
            orderBy: { createdAt: "asc" },
            include: {
              transactions: {
                orderBy: { date: "asc" },
                include: { attachments: { orderBy: { createdAt: "asc" } } },
              },
              recurringExpenses: { orderBy: { createdAt: "asc" } },
              tenants: { orderBy: { createdAt: "asc" } },
              rentChanges: { orderBy: { effectiveFrom: "asc" } },
              requests: REQUEST_INCLUDE,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    companies: companies.map((c) => ({
      name: c.name,
      contactPhone: c.contactPhone ?? "",
      contactEmail: c.contactEmail ?? "",
      properties: c.properties.map((p) => ({
        name: p.name,
        address: p.address ?? "",
        monthlyRent: p.monthlyRent,
        vacant: p.vacant,
        transactions: serializeTxns(p.transactions),
        recurringExpenses: serializeRecurring(p.recurringExpenses),
        tenants: serializeTenants(p.tenants),
        rentChanges: serializeRentChanges(p.rentChanges),
        requests: serializeRequests(p.requests),
        units: p.units.map((u) => ({
          name: u.name,
          monthlyRent: u.monthlyRent,
          vacant: u.vacant,
          transactions: serializeTxns(u.transactions),
          recurringExpenses: serializeRecurring(u.recurringExpenses),
          tenants: serializeTenants(u.tenants),
          rentChanges: serializeRentChanges(u.rentChanges),
          requests: serializeRequests(u.requests),
        })),
      })),
    })),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rent-roll-backup-${stamp}.json"`,
    },
  });
}
