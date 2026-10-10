import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { backupFileKey } from "@/lib/backup-files";
import { storageAccessOf } from "@/lib/file-links";
import { settingsFromRow } from "@/lib/reminders";
import { policyDTO } from "@/lib/statements";
import { purchaseOf } from "@/lib/returns-db";

export const BACKUP_FORMAT = "rent-roll-backup";
export const BACKUP_VERSION = 17;

/** Signs a private file's link for the account exporting it; see lib/backup-files. */
type FileKey = (url: string) => string | undefined;

type TxnRow = {
  type: string;
  date: Date;
  amount: number;
  detail: string | null;
  note: string | null;
  category: string | null;
  appliesTo: string | null;
  spreadMonths: number | null;
  attachments: { url: string; filename: string; contentType: string; size: number }[];
  vendor: { name: string } | null;
  loanPayment: { loanId: string; month: string } | null;
  moveOut: { tenantId: string; tenant: { name: string } } | null;
  bankRef: string | null;
  bankText: string | null;
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
    // Rent counted toward another month than the one it arrived in.
    appliesTo: t.appliesTo ?? "",
    // Spread across this many months (lib/spread); 0 when not.
    spreadMonths: t.spreadMonths ?? 0,
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
    // Bank import (a24): the statement line it came from, so a restored LLC
    // still knows which lines it already has, and the bank's words, which
    // the next import learns payees from.
    bankRef: t.bankRef ?? "",
    bankText: t.bankText ?? "",
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

const INSPECTION_INCLUDE = {
  orderBy: [{ inspectedOn: "asc" as const }, { createdAt: "asc" as const }],
  include: {
    items: {
      orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
      include: { photos: { orderBy: { createdAt: "asc" as const } } },
    },
  },
};

type TenantRow = {
  inspections?: {
    kind: string;
    inspectedOn: Date;
    note: string | null;
    sharedAt: Date | null;
    acknowledgedAt: Date | null;
    acknowledgedName: string | null;
    tenantComment: string | null;
    items: {
      room: string;
      name: string;
      condition: string;
      note: string | null;
      photos: { url: string; filename: string; contentType: string; size: number }[];
    }[];
  }[];
  notices?: { kind: string; month: string | null; amount: number | null; body: string; createdAt: Date; readAt: Date | null }[];
  thread?: {
    tenantReadAt: Date | null;
    landlordReadAt: Date | null;
    messages: {
      fromTenant: boolean;
      authorName: string;
      body: string;
      createdAt: Date;
      attachments: { url: string; filename: string; contentType: string; size: number }[];
    }[];
  } | null;
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
    dailyAmount: number;
    capPercent: number;
    fromPolicy: boolean;
    accrueFrom: string;
    runs: { month: string; day: string; amount: number; ranAt: Date }[];
  }[];
  /** Lease renewals (a25). */
  renewals?: {
    previousEnd: Date | null;
    newEnd: Date;
    previousRent: number;
    newRent: number;
    rentFrom: string;
    note: string | null;
    sentAt: Date | null;
    createdAt: Date;
  }[];
  /** Late fee waivers (a21). */
  lateFeeWaivers?: {
    month: string;
    waivedByName: string;
    waivedAt: Date;
    note: string | null;
    unwaivedAt: Date | null;
    unwaivedByName: string;
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
  lateFeeMode: string;
};

function serializeTenants(rows: TenantRow[], key: FileKey) {
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
    // Whether the LLC's late-fee policy, their own rules, or nothing bills
    // them when rent is late. A restore that forgot this would put a tenant
    // the landlord had excused back on the policy.
    lateFeeMode: t.lateFeeMode,
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
      // The daily amount and cap, and whether this is the rule the
      // LLC's late-fee policy keeps in step — restored as such, so the policy
      // finds it again rather than making a second one and billing twice.
      dailyAmount: r.dailyAmount,
      capPercent: r.capPercent,
      fromPolicy: r.fromPolicy,
      // The day the rule started charging (a18). Without it a restored
      // rule would backfill daily fees to before it existed.
      accrueFrom: r.accrueFrom,
      runs: r.runs.map((run) => ({
        month: run.month,
        // "" for the month's one-time fee, YYYY-MM-DD for a daily one.
        day: run.day,
        amount: run.amount,
        ranAt: run.ranAt.toISOString(),
      })),
    })),
    // Late fee waivers (a21): months whose late fee was let go, and any
    // taken back with the day — that day is what stops a restore billing
    // the waived days. Who did it goes by name; ids don't survive a restore.
    // Lease renewals (a25): what each changed, so the letters and the
    // card read the same after a restore.
    renewals: (t.renewals ?? []).map((r) => ({
      previousEnd: r.previousEnd ? r.previousEnd.toISOString().slice(0, 10) : "",
      newEnd: r.newEnd.toISOString().slice(0, 10),
      previousRent: r.previousRent,
      newRent: r.newRent,
      rentFrom: r.rentFrom,
      note: r.note ?? "",
      sentAt: r.sentAt ? r.sentAt.toISOString() : "",
      createdAt: r.createdAt.toISOString(),
    })),
    // Move-in and move-out inspections (a32), signature and photos with
    // them: the record a deposit deduction rests on is exactly what a
    // backup is for. Photos are links, signed like every other file here.
    inspections: (t.inspections ?? []).map((i) => ({
      kind: i.kind,
      inspectedOn: i.inspectedOn.toISOString().slice(0, 10),
      note: i.note ?? "",
      sharedAt: i.sharedAt ? i.sharedAt.toISOString() : "",
      acknowledgedAt: i.acknowledgedAt ? i.acknowledgedAt.toISOString() : "",
      acknowledgedName: i.acknowledgedName ?? "",
      tenantComment: i.tenantComment ?? "",
      items: i.items.map((it) => ({
        room: it.room,
        name: it.name,
        condition: it.condition,
        note: it.note ?? "",
        photos: it.photos.map((p) => ({
          url: p.url,
          key: key(p.url),
          filename: p.filename,
          contentType: p.contentType,
          size: p.size,
        })),
      })),
    })),
    lateFeeWaivers: (t.lateFeeWaivers ?? []).map((w) => ({
      month: w.month,
      waivedByName: w.waivedByName,
      waivedAt: w.waivedAt.toISOString(),
      note: w.note ?? "",
      unwaivedAt: w.unwaivedAt ? w.unwaivedAt.toISOString() : "",
      unwaivedByName: w.unwaivedByName,
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
    // The conversation with them, and how far each side had read. The
    // author of a landlord message is kept by name, like a repair reply;
    // attachments are links into storage, signed like receipts.
    messagesReadAt: t.thread
      ? {
          tenant: t.thread.tenantReadAt ? t.thread.tenantReadAt.toISOString() : "",
          landlord: t.thread.landlordReadAt ? t.thread.landlordReadAt.toISOString() : "",
        }
      : null,
    messages: (t.thread?.messages ?? []).map((m) => ({
      fromTenant: m.fromTenant,
      authorName: m.authorName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      attachments: m.attachments.map((a) => ({
        url: a.url,
        key: key(a.url),
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      })),
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

function serializeRentChanges(rows: { effectiveFrom: Date; amount: number; scheduledAt?: Date | null; appliedAt?: Date | null }[]) {
  return rows.map((c) => ({
    effectiveFrom: c.effectiveFrom.toISOString().slice(0, 10),
    amount: c.amount,
    // A raise renewed ahead of time that isn't today's rent yet (a25), so
    // a restore still moves today's rent when its month comes.
    scheduled: Boolean(c.scheduledAt && !c.appliedAt),
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
      lateFeePolicy: true,
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
          valuations: { orderBy: [{ asOf: "asc" }, { createdAt: "asc" }] }, // a31
          tenants: {
            where: { unitId: null },
            orderBy: { createdAt: "asc" },
            include: {
              notices: { orderBy: { createdAt: "asc" } },
              charges: { orderBy: { createdAt: "asc" } },
              thread: { include: { messages: { orderBy: { createdAt: "asc" }, include: { attachments: { orderBy: { createdAt: "asc" } } } } } },
              moveOut: { include: { deductions: { orderBy: { id: "asc" } } } },
              rules: { orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { month: "asc" } } } },
              lateFeeWaivers: { orderBy: { month: "asc" } }, // a21
              renewals: { orderBy: { createdAt: "asc" } }, // a25
              inspections: INSPECTION_INCLUDE, // a32
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
                  thread: { include: { messages: { orderBy: { createdAt: "asc" }, include: { attachments: { orderBy: { createdAt: "asc" } } } } } },
                  moveOut: { include: { deductions: { orderBy: { id: "asc" } } } },
              rules: { orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { month: "asc" } } } },
              lateFeeWaivers: { orderBy: { month: "asc" } }, // a21
              renewals: { orderBy: { createdAt: "asc" } }, // a25
              inspections: INSPECTION_INCLUDE, // a32
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
      // The LLC-wide late-fee policy, or null when none was ever saved.
      lateFees: c.lateFeePolicy ? policyDTO(c.lateFeePolicy) : null,
      // The vendor book, so a restore brings back who did each repair.
      vendors: c.vendors.map((v) => ({
        name: v.name,
        trade: v.trade,
        taxClass: v.taxClass ?? "", // a26
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
        // What was paid and what it's worth since (a31), so a restore keeps
        // the returns; without them every figure on the Returns page is "—".
        purchase: purchaseOf(p),
        valuations: p.valuations.map((v) => ({
          value: v.value,
          asOf: v.asOf.toISOString().slice(0, 10),
          source: v.source ?? "",
          note: v.note ?? "",
        })),
        tenants: serializeTenants(p.tenants, key),
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
          tenants: serializeTenants(u.tenants, key),
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
