import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { backupFileKey } from "@/lib/backup-files";
import { storageAccessOf } from "@/lib/file-links";
import { settingsFromRow } from "@/lib/reminders";

export const BACKUP_FORMAT = "rent-roll-backup";
export const BACKUP_VERSION = 16;

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
  loanPayment: { loanId: string; month: string } | null;
  moveOut: { tenantId: string; tenant: { name: string } } | null;
};

/** Position of each of a property's loans in its `loans` list, by id. */
type LoanIndex = Map<string, number>;

/** Position of each tenant of a place in its `tenants` list, by id. */
type TenantIndex = Map<string, number>;

function serializeTxns(txns: TxnRow[], key: FileKey, loanIndex: LoanIndex, tenantIndex: TenantIndex) {
  return txns.map((t) => ({
    type: t.type,
    date: t.date.toISOString().slice(0, 10),
    amount: t.amount,
    detail: t.detail ?? "",
    note: t.note ?? "",
    category: t.category ?? "",
    // By name: ids don't survive a restore into a fresh database.
    vendorName: t.vendor?.name ?? "",
    // Which mortgage payment wrote this entry, as the loan's position in the
    // property's `loans` and the month — ids don't survive a restore. Without
    // it a restored interest entry could be deleted on its own, leaving the
    // loan's balance and the books disagreeing.
    loanPayment:
      t.loanPayment && loanIndex.has(t.loanPayment.loanId)
        ? { loan: loanIndex.get(t.loanPayment.loanId), month: t.loanPayment.month }
        : null,
    // Deposit money kept at a move-out: whose, by their position in this
    // place's `tenants` — a returning tenant can appear twice under one name,
    // and a name would pin both tenancies' money to the first. The name rides
    // along for anyone reading the file.
    moveOutTenant: t.moveOut ? (tenantIndex.get(t.moveOut.tenantId) ?? null) : null,
    moveOutOf: t.moveOut?.tenant.name ?? "",
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

type LoanRow = {
  id: string;
  lender: string;
  balance: number;
  balanceAsOf: string;
  rate: number;
  payment: number;
  escrowTax: number;
  escrowInsurance: number;
  dueDay: number;
  active: boolean;
  note: string | null;
  payments: { month: string; date: Date; principal: number; interest: number; escrow: number }[];
};

/**
 * Mortgages with every payment's split. The principal lives only here — it
 * never went into the ledger — so without these a restore would lose how
 * much of every loan has been paid down.
 */
function serializeLoans(rows: LoanRow[]) {
  return rows.map((l) => ({
    lender: l.lender,
    balance: l.balance,
    balanceAsOf: l.balanceAsOf,
    rate: l.rate,
    payment: l.payment,
    escrowTax: l.escrowTax,
    escrowInsurance: l.escrowInsurance,
    dueDay: l.dueDay,
    active: l.active,
    note: l.note ?? "",
    payments: l.payments.map((p) => ({
      month: p.month,
      date: p.date.toISOString().slice(0, 10),
      principal: p.principal,
      interest: p.interest,
      escrow: p.escrow,
    })),
  }));
}

type TenantRow = {
  notices?: { kind: string; month: string | null; amount: number | null; body: string; createdAt: Date; readAt: Date | null }[];
  charges?: {
    month: string;
    kind: string;
    label: string;
    amount: number;
    createdAt: Date;
    ruleId: string | null;
    moveOutId: string | null;
  }[];
  moveOut?: {
    movedOutOn: Date;
    lastRentMonth: string;
    deposit: number;
    refund: number;
    returnBy: Date | null;
    returnedOn: Date | null;
    returnNote: string | null;
    forwardingAddress: string | null;
    madeVacant: boolean;
    deductions: { kind: string; label: string; amount: number }[];
  } | null;
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
  emailReminders: boolean;
  pushReminders: boolean;
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
    // Their say over automatic reminders, so a restore doesn't start
    // emailing someone who asked it to stop.
    emailReminders: t.emailReminders,
    pushReminders: t.pushReminders,
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
      // A charge the deposit paid at move-out, so a restore keeps the pair.
      moveOut: Boolean(c.moveOutId),
    })),
    // How the tenancy ended and where the deposit went. The part of it kept
    // is in the ledger already; this is the rest — the itemized list, what
    // was owed back, and whether it went.
    moveOut: t.moveOut
      ? {
          movedOutOn: t.moveOut.movedOutOn.toISOString().slice(0, 10),
          lastRentMonth: t.moveOut.lastRentMonth,
          deposit: t.moveOut.deposit,
          refund: t.moveOut.refund,
          returnBy: t.moveOut.returnBy ? t.moveOut.returnBy.toISOString().slice(0, 10) : "",
          returnedOn: t.moveOut.returnedOn ? t.moveOut.returnedOn.toISOString().slice(0, 10) : "",
          returnNote: t.moveOut.returnNote ?? "",
          forwardingAddress: t.moveOut.forwardingAddress ?? "",
          madeVacant: t.moveOut.madeVacant,
          deductions: t.moveOut.deductions.map((d) => ({ kind: d.kind, label: d.label, amount: d.amount })),
        }
      : null,
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
  sharedWithOwners: boolean;
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
    // Whether the property's owners (owner portal) may read it.
    sharedWithOwners: d.sharedWithOwners,
    tenantName: d.tenant?.name ?? "",
    vendorName: d.vendor?.name ?? "",
  }));
}

/**
 * Property owners (the owner portal) by email, with their properties as
 * positions in the company's `properties`. No password: a restored owner
 * is re-invited and picks a new one, which is also the right thing when
 * the backup came from someone else's export.
 */
function serializePropertyOwners(properties: { ownerAccess: { owner: { email: string; name: string; monthlyEmail: boolean } }[] }[]) {
  const out = new Map<string, { email: string; name: string; monthlyEmail: boolean; properties: number[] }>();
  properties.forEach((p, at) => {
    for (const a of p.ownerAccess) {
      let entry = out.get(a.owner.email);
      if (!entry) {
        entry = { email: a.owner.email, name: a.owner.name, monthlyEmail: a.owner.monthlyEmail, properties: [] };
        out.set(a.owner.email, entry);
      }
      entry.properties.push(at);
    }
  });
  return Array.from(out.values());
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
      reminders: true,
      properties: {
        orderBy: { createdAt: "asc" },
        include: {
          transactions: {
            where: { unitId: null },
            orderBy: { date: "asc" },
            include: {
              attachments: { orderBy: { createdAt: "asc" } },
              vendor: { select: { name: true } },
              loanPayment: { select: { loanId: true, month: true } },
              moveOut: { select: { tenantId: true, tenant: { select: { name: true } } } },
            },
          },
          recurringExpenses: { where: { unitId: null }, orderBy: { createdAt: "asc" } },
          loans: { orderBy: { createdAt: "asc" }, include: { payments: { orderBy: { month: "asc" } } } },
          assets: { orderBy: { createdAt: "asc" } },
          tenants: {
            where: { unitId: null },
            orderBy: { createdAt: "asc" },
            include: {
              notices: { orderBy: { createdAt: "asc" } },
              charges: { orderBy: { createdAt: "asc" } },
              moveOut: { include: { deductions: { orderBy: { id: "asc" } } } },
              rules: { orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { month: "asc" } } } },
            },
          },
          rentChanges: { where: { unitId: null }, orderBy: { effectiveFrom: "asc" } },
          requests: { ...REQUEST_INCLUDE, where: { unitId: null } },
          documents: DOCUMENT_INCLUDE,
          ownerAccess: { include: { owner: { select: { email: true, name: true, monthlyEmail: true } } } },
          units: {
            orderBy: { createdAt: "asc" },
            include: {
              transactions: {
                orderBy: { date: "asc" },
                include: {
              attachments: { orderBy: { createdAt: "asc" } },
              vendor: { select: { name: true } },
              loanPayment: { select: { loanId: true, month: true } },
              moveOut: { select: { tenantId: true, tenant: { select: { name: true } } } },
            },
              },
              recurringExpenses: { orderBy: { createdAt: "asc" } },
              tenants: {
                orderBy: { createdAt: "asc" },
                include: {
                  notices: { orderBy: { createdAt: "asc" } },
                  charges: { orderBy: { createdAt: "asc" } },
                  moveOut: { include: { deductions: { orderBy: { id: "asc" } } } },
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
      // How automatic reminders are set up, or null when they never were.
      reminders: c.reminders ? settingsFromRow(c.reminders) : null,
      // The vendor book, so a restore brings back who did each repair.
      vendors: c.vendors.map((v) => ({
        name: v.name,
        trade: v.trade,
        phone: v.phone ?? "",
        email: v.email ?? "",
        note: v.note ?? "",
      })),
      documents: serializeDocuments(c.documents, key),
      // Who has owner-portal access to which of these properties.
      propertyOwners: serializePropertyOwners(c.properties),
      properties: c.properties.map((p) => {
        const loanIndex: LoanIndex = new Map(p.loans.map((l, i) => [l.id, i]));
        return {
        name: p.name,
        address: p.address ?? "",
        monthlyRent: p.monthlyRent,
        vacant: p.vacant,
        vacantSince: p.vacantSince ? p.vacantSince.toISOString().slice(0, 10) : "",
        transactions: serializeTxns(p.transactions, key, loanIndex, new Map(p.tenants.map((t, i) => [t.id, i]))),
        recurringExpenses: serializeRecurring(p.recurringExpenses),
        loans: serializeLoans(p.loans),
        // What's being depreciated. Without it a restore would quietly drop
        // the largest deduction from every future tax export.
        assets: p.assets.map((a) => ({
          kind: a.kind,
          label: a.label,
          cls: a.cls,
          basis: a.basis,
          inService: a.inService,
          note: a.note ?? "",
        })),
        tenants: serializeTenants(p.tenants),
        rentChanges: serializeRentChanges(p.rentChanges),
        requests: serializeRequests(p.requests, key),
        documents: serializeDocuments(p.documents, key),
        units: p.units.map((u) => ({
          name: u.name,
          monthlyRent: u.monthlyRent,
          vacant: u.vacant,
          vacantSince: u.vacantSince ? u.vacantSince.toISOString().slice(0, 10) : "",
          transactions: serializeTxns(u.transactions, key, loanIndex, new Map(u.tenants.map((t, i) => [t.id, i]))),
          recurringExpenses: serializeRecurring(u.recurringExpenses),
          tenants: serializeTenants(u.tenants),
          rentChanges: serializeRentChanges(u.rentChanges),
          requests: serializeRequests(u.requests, key),
        })),
        };
      }),
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
