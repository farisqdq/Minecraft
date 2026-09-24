import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { backupFileKey } from "@/lib/backup-files";
import { storageAccessOf } from "@/lib/file-links";

export const BACKUP_FORMAT = "rent-roll-backup";
export const BACKUP_VERSION = 10;

/** Signs a private file's link for the account exporting it; see lib/backup-files. */
type FileKey = (url: string) => string | undefined;

type TxnRow = {
  type: string;
  date: Date;
  amount: number;
  detail: string | null;
  note: string | null;
  category: string | null;
  attachments: { url: string; filename: string; contentType: string; size: number }[];
  vendor: { name: string } | null;
};

function serializeTxns(txns: TxnRow[], key: FileKey) {
  return txns.map((t) => ({
    type: t.type,
    date: t.date.toISOString().slice(0, 10),
    amount: t.amount,
    detail: t.detail ?? "",
    note: t.note ?? "",
    category: t.category ?? "",
    // By name: ids don't survive a restore into a fresh database.
    vendorName: t.vendor?.name ?? "",
    // Links to the stored files, not the files themselves — they stay in
    // blob storage and keep working as long as the app does.
    attachments: t.attachments.map((a) => ({
      url: a.url,
      key: key(a.url),
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
  notices?: { kind: string; month: string | null; amount: number | null; body: string; createdAt: Date; readAt: Date | null }[];
  charges?: { month: string; kind: string; label: string; amount: number; createdAt: Date; ruleId: string | null }[];
  rules?: {
    id: string;
    kind: string;
    label: string;
    amount: number;
    percent: boolean;
    graceDays: number;
    startMonth: string | null;
    endMonth: string | null;
    active: boolean;
    runs: { month: string; amount: number; ranAt: Date }[];
  }[];
  openingBalance: number;
  balanceFrom: string | null;
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
    // Where the books start for them and what they owed on that day. Without
    // these two a restore would re-infer the start from the first payment and
    // quietly forget an opening balance the landlord had set by hand.
    openingBalance: t.openingBalance,
    balanceFrom: t.balanceFrom ?? "",
    // Anything owed on top of rent. Rent itself isn't here because it isn't
    // stored — it comes back with the rent history.
    charges: (t.charges ?? []).map((c) => ({
      month: c.month,
      kind: c.kind,
      label: c.label,
      amount: c.amount,
      createdAt: c.createdAt.toISOString(),
      // Which rule made it, by its position in `rules` below — ids don't
      // survive a restore into a fresh database, positions do.
      rule: c.ruleId ? (t.rules ?? []).findIndex((r) => r.id === c.ruleId) : -1,
    })),
    // Standing rules, with the months each has already run for. The runs
    // matter as much as the rules: without them a restore would bill again
    // every rule charge you had deleted.
    rules: (t.rules ?? []).map((r) => ({
      kind: r.kind,
      label: r.label,
      amount: r.amount,
      percent: r.percent,
      graceDays: r.graceDays,
      startMonth: r.startMonth ?? "",
      endMonth: r.endMonth ?? "",
      active: r.active,
      runs: r.runs.map((run) => ({
        month: run.month,
        amount: run.amount,
        ranAt: run.ranAt.toISOString(),
      })),
    })),
    // When you chased them and whether they read it. Kept because that is
    // the part a backup is for — the record, not the conversation.
    notices: (t.notices ?? []).map((n) => ({
      kind: n.kind,
      month: n.month ?? "",
      amount: n.amount ?? 0,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : "",
    })),
  }));
}

type DocumentRow = {
  title: string;
  kind: string;
  url: string;
  pathname: string;
  filename: string;
  contentType: string;
  size: number;
  expiresOn: Date | null;
  note: string | null;
  shared: boolean;
  tenant: { name: string } | null;
  vendor: { name: string } | null;
};

/**
 * Links to the stored files, like receipts — the files stay in blob storage.
 * What each is attached to goes by name, because ids don't survive a restore.
 */
function serializeDocuments(rows: DocumentRow[], key: FileKey) {
  return rows.map((d) => ({
    title: d.title,
    kind: d.kind,
    url: d.url,
    key: key(d.url),
    pathname: d.pathname,
    filename: d.filename,
    contentType: d.contentType,
    size: d.size,
    expiresOn: d.expiresOn ? d.expiresOn.toISOString().slice(0, 10) : "",
    note: d.note ?? "",
    shared: d.shared,
    tenantName: d.tenant?.name ?? "",
    vendorName: d.vendor?.name ?? "",
  }));
}

const DOCUMENT_INCLUDE = {
  orderBy: { createdAt: "asc" },
  include: { tenant: { select: { name: true } }, vendor: { select: { name: true } } },
} as const;

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
  vendor: { name: string } | null;
  photos: { url: string; filename: string; contentType: string; size: number }[];
  updates: { authorName: string; body: string; statusTo: string | null; createdAt: Date }[];
};

/**
 * Repairs go out with the thread and the photo links, but the tenant is
 * carried as a name rather than an id: ids don't survive a restore into a
 * fresh database, and the name is what re-links it to the tenant row that
 * comes back alongside it.
 */
function serializeRequests(rows: RequestRow[], key: FileKey) {
  return rows.map((r) => ({
    title: r.title,
    detail: r.detail,
    category: r.category,
    place: r.place ?? "",
    urgency: r.urgency,
    status: r.status,
    tenantName: r.tenant?.name ?? "",
    vendorName: r.vendor?.name ?? "",
    createdAt: r.createdAt.toISOString(),
    seenAt: r.seenAt ? r.seenAt.toISOString() : "",
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : "",
    photos: r.photos.map((p) => ({
      url: p.url,
      key: key(p.url),
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
    vendor: { select: { name: true } },
    photos: { orderBy: { createdAt: "asc" } },
    updates: { orderBy: { createdAt: "asc" } },
  },
} as const;

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = me.id;
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  const key: FileKey = (url) =>
    storageAccessOf(url) === "private" ? backupFileKey(secret, me.email, url) : undefined;

  const companyIds = await companyIdsForUser(userId);
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    include: {
      vendors: { orderBy: { createdAt: "asc" } },
      // Paperwork not tied to a property: a vendor's insurance, an LLC's own
      // licence. Property and tenant documents travel with their property.
      documents: { ...DOCUMENT_INCLUDE, where: { propertyId: null } },
      properties: {
        orderBy: { createdAt: "asc" },
        include: {
          transactions: {
            where: { unitId: null },
            orderBy: { date: "asc" },
            include: { attachments: { orderBy: { createdAt: "asc" } }, vendor: { select: { name: true } } },
          },
          recurringExpenses: { where: { unitId: null }, orderBy: { createdAt: "asc" } },
          tenants: {
            where: { unitId: null },
            orderBy: { createdAt: "asc" },
            include: {
              notices: { orderBy: { createdAt: "asc" } },
              charges: { orderBy: { createdAt: "asc" } },
              rules: { orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { month: "asc" } } } },
            },
          },
          rentChanges: { where: { unitId: null }, orderBy: { effectiveFrom: "asc" } },
          requests: { ...REQUEST_INCLUDE, where: { unitId: null } },
          documents: DOCUMENT_INCLUDE,
          units: {
            orderBy: { createdAt: "asc" },
            include: {
              transactions: {
                orderBy: { date: "asc" },
                include: { attachments: { orderBy: { createdAt: "asc" } }, vendor: { select: { name: true } } },
              },
              recurringExpenses: { orderBy: { createdAt: "asc" } },
              tenants: {
                orderBy: { createdAt: "asc" },
                include: {
                  notices: { orderBy: { createdAt: "asc" } },
                  charges: { orderBy: { createdAt: "asc" } },
              rules: { orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { month: "asc" } } } },
                },
              },
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
      // The vendor book, so a restore brings back who did each repair.
      vendors: c.vendors.map((v) => ({
        name: v.name,
        trade: v.trade,
        phone: v.phone ?? "",
        email: v.email ?? "",
        note: v.note ?? "",
      })),
      documents: serializeDocuments(c.documents, key),
      properties: c.properties.map((p) => ({
        name: p.name,
        address: p.address ?? "",
        monthlyRent: p.monthlyRent,
        vacant: p.vacant,
        transactions: serializeTxns(p.transactions, key),
        recurringExpenses: serializeRecurring(p.recurringExpenses),
        tenants: serializeTenants(p.tenants),
        rentChanges: serializeRentChanges(p.rentChanges),
        requests: serializeRequests(p.requests, key),
        documents: serializeDocuments(p.documents, key),
        units: p.units.map((u) => ({
          name: u.name,
          monthlyRent: u.monthlyRent,
          vacant: u.vacant,
          transactions: serializeTxns(u.transactions, key),
          recurringExpenses: serializeRecurring(u.recurringExpenses),
          tenants: serializeTenants(u.tenants),
          rentChanges: serializeRentChanges(u.rentChanges),
          requests: serializeRequests(u.requests, key),
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
