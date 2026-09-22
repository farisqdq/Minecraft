import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { BACKUP_FORMAT } from "../route";
import { normalizeCategory } from "@/lib/categories";
import { normalizeTrade } from "@/lib/vendors";
import { normalizeKind } from "@/lib/documents";
import { normalizeCategory as normalizeRequestCategory, normalizeStatus } from "@/lib/maintenance";

type Tx = Prisma.TransactionClient;

const MAX_COMPANIES = 100;
const MAX_PROPERTIES = 2000;
const MAX_UNITS = 5000;
const MAX_TRANSACTIONS = 50000;
const MAX_RECURRING = 5000;
const MAX_TENANTS = 5000;
const MAX_RENT_CHANGES = 20000;
const MAX_REQUESTS = 20000;
const MAX_REQUEST_UPDATES = 100000;

type CleanAttachment = { url: string; filename: string; contentType: string; size: number };
type CleanTransaction = {
  type: string;
  date: Date;
  amount: number;
  detail: string | null;
  note: string | null;
  category: string | null;
  attachments: CleanAttachment[];
  /** Who was paid, by name — re-linked to this LLC's restored vendor book. */
  vendorName: string;
};
type CleanRecurring = {
  category: string;
  detail: string | null;
  note: string | null;
  amount: number;
  frequency: string;
  day: number;
  month: number | null;
  active: boolean;
};
type CleanNotice = {
  kind: string;
  month: string | null;
  amount: number | null;
  body: string;
  createdAt: Date;
  readAt: Date | null;
};
type CleanCharge = {
  month: string;
  kind: string;
  label: string;
  amount: number;
  createdAt: Date;
  /** Position in the tenant's `rules`, or -1 for a charge typed by hand. */
  rule: number;
};
type CleanRule = {
  kind: string;
  label: string;
  amount: number;
  percent: boolean;
  graceDays: number;
  startMonth: string | null;
  endMonth: string | null;
  active: boolean;
  runs: { month: string; amount: number; ranAt: Date }[];
};
type CleanTenant = {
  notices: CleanNotice[];
  charges: CleanCharge[];
  rules: CleanRule[];
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
type CleanRentChange = { effectiveFrom: Date; amount: number };
type CleanRequestUpdate = {
  authorName: string;
  body: string;
  statusTo: string | null;
  createdAt: Date;
};
type CleanRequest = {
  title: string;
  detail: string;
  category: string;
  place: string | null;
  urgency: string;
  status: string;
  tenantName: string;
  vendorName: string;
  createdAt: Date;
  seenAt: Date | null;
  resolvedAt: Date | null;
  photos: CleanAttachment[];
  updates: CleanRequestUpdate[];
};
type CleanUnit = {
  name: string;
  monthlyRent: number;
  vacant: boolean;
  transactions: CleanTransaction[];
  recurringExpenses: CleanRecurring[];
  tenants: CleanTenant[];
  rentChanges: CleanRentChange[];
  requests: CleanRequest[];
};
type CleanProperty = {
  name: string;
  address: string | null;
  monthlyRent: number;
  vacant: boolean;
  transactions: CleanTransaction[];
  recurringExpenses: CleanRecurring[];
  tenants: CleanTenant[];
  rentChanges: CleanRentChange[];
  requests: CleanRequest[];
  documents: CleanDocument[];
  units: CleanUnit[];
};
type CleanDocument = {
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
  tenantName: string;
  vendorName: string;
};
type CleanVendor = {
  name: string;
  trade: string;
  phone: string | null;
  email: string | null;
  note: string | null;
};
type CleanCompany = {
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
  vendors: CleanVendor[];
  documents: CleanDocument[];
  properties: CleanProperty[];
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const bool = (v: unknown) => v === true;
const day = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

const stamp = (v: unknown) => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/** Reshape an uploaded file into exactly what we're willing to store. */
function parseBackup(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("That file isn't a Rent Roll backup.");
  const body = raw as Record<string, unknown>;
  if (body.format !== BACKUP_FORMAT) {
    throw new Error("That file isn't a Rent Roll backup.");
  }
  if (!Array.isArray(body.companies)) throw new Error("That backup has no LLCs in it.");
  if (body.companies.length > MAX_COMPANIES) throw new Error("That backup is too large to import.");

  let propertyTotal = 0;
  let unitTotal = 0;
  let transactionTotal = 0;
  let recurringTotal = 0;
  let tenantTotal = 0;
  let rentChangeTotal = 0;
  let requestTotal = 0;
  let requestUpdateTotal = 0;

  function parseTransactions(raw: unknown): CleanTransaction[] {
    const out: CleanTransaction[] = [];
    for (const rawTxn of Array.isArray(raw) ? raw : []) {
      const t = (rawTxn ?? {}) as Record<string, unknown>;
      const date = typeof t.date === "string" ? new Date(t.date) : null;
      const amount = num(t.amount);
      if (!date || isNaN(date.getTime()) || amount <= 0) continue;
      if (++transactionTotal > MAX_TRANSACTIONS) throw new Error("That backup is too large to import.");

      const attachments: CleanAttachment[] = [];
      for (const rawAttachment of Array.isArray(t.attachments) ? t.attachments : []) {
        const a = (rawAttachment ?? {}) as Record<string, unknown>;
        const url = str(a.url, 1000);
        // Only re-link files still served over https; anything else in the
        // file would just render as a broken thumbnail.
        if (!/^https:\/\//i.test(url)) continue;
        attachments.push({
          url,
          filename: str(a.filename, 200) || "proof",
          contentType: str(a.contentType, 100) || "application/octet-stream",
          size: Math.round(num(a.size)),
        });
      }

      const type = t.type === "expense" ? "expense" : "rent";
      out.push({
        type,
        date,
        amount,
        detail: str(t.detail, 200) || null,
        note: str(t.note, 500) || null,
        category: type === "expense" ? normalizeCategory(t.category) : null,
        attachments,
        vendorName: type === "expense" ? str(t.vendorName, 120) : "",
      });
    }
    return out;
  }

  function parseRecurring(raw: unknown): CleanRecurring[] {
    const out: CleanRecurring[] = [];
    for (const rawR of Array.isArray(raw) ? raw : []) {
      const r = (rawR ?? {}) as Record<string, unknown>;
      const category = normalizeCategory(r.category);
      const amount = num(r.amount);
      if (!category || amount <= 0) continue;
      if (++recurringTotal > MAX_RECURRING) throw new Error("That backup is too large to import.");

      const frequency = r.frequency === "yearly" ? "yearly" : "monthly";
      out.push({
        category,
        detail: str(r.detail, 200) || null,
        note: str(r.note, 500) || null,
        amount,
        frequency,
        day: Math.min(31, Math.max(1, Math.round(num(r.day)) || 1)),
        month: frequency === "yearly" ? Math.min(12, Math.max(1, Math.round(num(r.month)) || 1)) : null,
        active: r.active !== false,
      });
    }
    return out;
  }

  function parseTenants(raw: unknown): CleanTenant[] {
    const out: CleanTenant[] = [];
    for (const rawT of Array.isArray(raw) ? raw : []) {
      const t = (rawT ?? {}) as Record<string, unknown>;
      const name = str(t.name, 120);
      if (!name) continue;
      if (++tenantTotal > MAX_TENANTS) throw new Error("That backup is too large to import.");

      const notices: CleanNotice[] = [];
      for (const rawN of Array.isArray(t.notices) ? t.notices : []) {
        const n = (rawN ?? {}) as Record<string, unknown>;
        const text = str(n.body, 2000);
        if (!text) continue;
        notices.push({
          kind: n.kind === "note" ? "note" : "rent",
          month: /^\d{4}-\d{2}$/.test(str(n.month, 7)) ? str(n.month, 7) : null,
          amount: num(n.amount) || null,
          body: text,
          createdAt: stamp(n.createdAt) ?? new Date(),
          readAt: stamp(n.readAt),
        });
      }

      const charges: CleanCharge[] = [];
      for (const rawC of Array.isArray(t.charges) ? t.charges : []) {
        const c = (rawC ?? {}) as Record<string, unknown>;
        const month = str(c.month, 7);
        const label = str(c.label, 120);
        const amount = num(c.amount);
        // A charge without a month can't be placed on the ledger and a
        // charge without an amount changes nothing, so neither comes back.
        if (!/^\d{4}-\d{2}$/.test(month) || !label || !(amount > 0)) continue;
        const ruleAt = Math.round(num(c.rule));
        charges.push({
          month,
          kind: c.kind === "credit" ? "credit" : "fee",
          label,
          amount,
          createdAt: stamp(c.createdAt) ?? new Date(),
          rule: Number.isFinite(ruleAt) && ruleAt >= 0 ? ruleAt : -1,
        });
      }

      const rules: CleanRule[] = [];
      for (const rawR of (Array.isArray(t.rules) ? t.rules : []).slice(0, 8)) {
        const r = (rawR ?? {}) as Record<string, unknown>;
        const label = str(r.label, 80);
        const amount = num(r.amount);
        const percent = r.percent === true;
        // The same limits the rules API enforces. A backup is a file anyone
        // could edit, so it gets no more trust than a form.
        if (!label || !(amount > 0) || (percent ? amount > 100 : amount > 2000)) continue;
        const startMonth = /^\d{4}-\d{2}$/.test(str(r.startMonth, 7)) ? str(r.startMonth, 7) : null;
        const endMonth = /^\d{4}-\d{2}$/.test(str(r.endMonth, 7)) ? str(r.endMonth, 7) : null;
        const seen = new Set<string>();
        const runs: CleanRule["runs"] = [];
        for (const rawRun of Array.isArray(r.runs) ? r.runs : []) {
          const run = (rawRun ?? {}) as Record<string, unknown>;
          const month = str(run.month, 7);
          if (!/^\d{4}-\d{2}$/.test(month) || seen.has(month)) continue;
          seen.add(month);
          runs.push({ month, amount: num(run.amount), ranAt: stamp(run.ranAt) ?? new Date() });
        }
        rules.push({
          kind: r.kind === "late" ? "late" : "monthly",
          label,
          amount,
          percent,
          graceDays: Math.min(28, Math.max(0, Math.round(num(r.graceDays)) || 0)),
          startMonth,
          endMonth,
          active: r.active !== false,
          runs,
        });
      }

      out.push({
        notices,
        charges,
        rules,
        openingBalance: num(t.openingBalance),
        balanceFrom: /^\d{4}-\d{2}$/.test(str(t.balanceFrom, 7)) ? str(t.balanceFrom, 7) : null,
        name,
        email: str(t.email, 200) || null,
        phone: str(t.phone, 40) || null,
        leaseStart: day(t.leaseStart),
        leaseEnd: day(t.leaseEnd),
        deposit: num(t.deposit),
        dueDay: Math.min(31, Math.max(1, Math.round(num(t.dueDay)) || 1)),
        active: t.active !== false,
        note: str(t.note, 500) || null,
      });
    }
    return out;
  }

  function parseRentChanges(raw: unknown): CleanRentChange[] {
    const out: CleanRentChange[] = [];
    for (const rawC of Array.isArray(raw) ? raw : []) {
      const c = (rawC ?? {}) as Record<string, unknown>;
      const effectiveFrom = day(c.effectiveFrom);
      const amount = num(c.amount);
      // A zero is a real rent (a place taken off the market), but a missing
      // date is not a history entry at all.
      if (!effectiveFrom) continue;
      if (++rentChangeTotal > MAX_RENT_CHANGES) throw new Error("That backup is too large to import.");
      out.push({ effectiveFrom, amount });
    }
    return out;
  }

  let documentTotal = 0;
  function parseDocuments(raw: unknown): CleanDocument[] {
    const out: CleanDocument[] = [];
    for (const rawD of Array.isArray(raw) ? raw : []) {
      const d = (rawD ?? {}) as Record<string, unknown>;
      const url = str(d.url, 1000);
      // Same rule as receipts: only files still served over https come back.
      if (!/^https:\/\//i.test(url)) continue;
      if (++documentTotal > 5000) throw new Error("That backup is too large to import.");
      const exp = str(d.expiresOn, 10);
      out.push({
        title: str(d.title, 120) || "Document",
        kind: normalizeKind(d.kind),
        url,
        pathname: str(d.pathname, 500) || new URL(url).pathname.replace(/^\//, ""),
        filename: str(d.filename, 200) || "document",
        contentType: str(d.contentType, 100) || "application/pdf",
        size: Math.max(0, Math.round(num(d.size))),
        expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? new Date(`${exp}T00:00:00.000Z`) : null,
        note: str(d.note, 500) || null,
        shared: d.shared === true,
        tenantName: str(d.tenantName, 120),
        vendorName: str(d.vendorName, 120),
      });
    }
    return out;
  }

  function parseRequests(raw: unknown): CleanRequest[] {
    const out: CleanRequest[] = [];
    for (const rawR of Array.isArray(raw) ? raw : []) {
      const r = (rawR ?? {}) as Record<string, unknown>;
      const title = str(r.title, 120);
      const category = normalizeRequestCategory(r.category);
      // A report with no words is not a report; an unknown category is
      // salvageable, so it lands in "Other" rather than being dropped.
      if (!title) continue;
      if (++requestTotal > MAX_REQUESTS) throw new Error("That backup is too large to import.");

      const photos: CleanAttachment[] = [];
      for (const rawPhoto of Array.isArray(r.photos) ? r.photos : []) {
        const a = (rawPhoto ?? {}) as Record<string, unknown>;
        const url = str(a.url, 1000);
        if (!/^https:\/\//i.test(url)) continue;
        photos.push({
          url,
          filename: str(a.filename, 200) || "photo",
          contentType: str(a.contentType, 100) || "image/jpeg",
          size: Math.round(num(a.size)),
        });
      }

      const updates: CleanRequestUpdate[] = [];
      for (const rawUpdate of Array.isArray(r.updates) ? r.updates : []) {
        const u = (rawUpdate ?? {}) as Record<string, unknown>;
        const body = str(u.body, 2000);
        const statusTo = normalizeStatus(u.statusTo);
        if (!body && !statusTo) continue;
        if (++requestUpdateTotal > MAX_REQUEST_UPDATES) {
          throw new Error("That backup is too large to import.");
        }
        updates.push({
          authorName: str(u.authorName, 120) || "Someone",
          body,
          statusTo,
          createdAt: stamp(u.createdAt) ?? new Date(),
        });
      }

      out.push({
        title,
        detail: str(r.detail, 4000),
        category: category ?? "Other",
        place: str(r.place, 80) || null,
        urgency: r.urgency === "urgent" ? "urgent" : "normal",
        status: normalizeStatus(r.status) ?? "open",
        tenantName: str(r.tenantName, 120),
        vendorName: str(r.vendorName, 120),
        createdAt: stamp(r.createdAt) ?? new Date(),
        seenAt: stamp(r.seenAt),
        resolvedAt: stamp(r.resolvedAt),
        photos,
        updates,
      });
    }
    return out;
  }

  const companies: CleanCompany[] = [];
  for (const rawCompany of body.companies) {
    const c = (rawCompany ?? {}) as Record<string, unknown>;
    const name = str(c.name, 120);
    if (!name) continue;

    const properties: CleanProperty[] = [];
    for (const rawProperty of Array.isArray(c.properties) ? c.properties : []) {
      const p = (rawProperty ?? {}) as Record<string, unknown>;
      const propName = str(p.name, 120);
      if (!propName) continue;
      if (++propertyTotal > MAX_PROPERTIES) throw new Error("That backup is too large to import.");

      const units: CleanUnit[] = [];
      for (const rawUnit of Array.isArray(p.units) ? p.units : []) {
        const u = (rawUnit ?? {}) as Record<string, unknown>;
        const unitName = str(u.name, 120);
        if (!unitName) continue;
        if (++unitTotal > MAX_UNITS) throw new Error("That backup is too large to import.");

        units.push({
          name: unitName,
          monthlyRent: num(u.monthlyRent),
          vacant: bool(u.vacant),
          transactions: parseTransactions(u.transactions),
          recurringExpenses: parseRecurring(u.recurringExpenses),
          tenants: parseTenants(u.tenants),
          rentChanges: parseRentChanges(u.rentChanges),
          requests: parseRequests(u.requests),
        });
      }

      properties.push({
        name: propName,
        address: str(p.address, 250) || null,
        monthlyRent: num(p.monthlyRent),
        vacant: bool(p.vacant),
        transactions: parseTransactions(p.transactions),
        recurringExpenses: parseRecurring(p.recurringExpenses),
        tenants: parseTenants(p.tenants),
        rentChanges: parseRentChanges(p.rentChanges),
        requests: parseRequests(p.requests),
        documents: parseDocuments(p.documents),
        units,
      });
    }

    const vendors: CleanVendor[] = [];
    const vendorNames = new Set<string>();
    for (const rawV of (Array.isArray(c.vendors) ? c.vendors : []).slice(0, 200)) {
      const v = (rawV ?? {}) as Record<string, unknown>;
      const vName = str(v.name, 120);
      // Names are how repairs and expenses find their vendor again, so a
      // duplicate would make that ambiguous: the first one wins.
      if (!vName || vendorNames.has(vName)) continue;
      vendorNames.add(vName);
      vendors.push({
        name: vName,
        trade: normalizeTrade(v.trade),
        phone: str(v.phone, 40) || null,
        email: str(v.email, 200) || null,
        note: str(v.note, 500) || null,
      });
    }

    companies.push({
      name,
      contactPhone: str(c.contactPhone, 40) || null,
      contactEmail: str(c.contactEmail, 200) || null,
      vendors,
      documents: parseDocuments(c.documents),
      properties,
    });
  }

  if (companies.length === 0) throw new Error("That backup has no LLCs in it.");
  return {
    companies,
    propertyTotal,
    unitTotal,
    transactionTotal,
    recurringTotal,
    tenantTotal,
    rentChangeTotal,
    requestTotal,
  };
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.json().catch(() => null);

  let parsed;
  try {
    parsed = parseBackup(raw);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Importing only ever adds: an LLC whose name is already taken comes in
  // under a suffixed name rather than merging into (or replacing) the original.
  const existing = await prisma.companyMember.findMany({
    where: { userId },
    include: { company: { select: { name: true } } },
  });
  const taken = new Set(existing.map((m) => m.company.name));

  function uniqueName(name: string) {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    let candidate = `${name} (imported)`;
    let n = 2;
    while (taken.has(candidate)) candidate = `${name} (imported ${n++})`;
    taken.add(candidate);
    return candidate;
  }

  const created = {
    companies: 0,
    properties: 0,
    units: 0,
    transactions: 0,
    attachments: 0,
    recurring: 0,
    tenants: 0,
    charges: 0,
    rules: 0,
    vendors: 0,
    documents: 0,
    rentChanges: 0,
    requests: 0,
  };

  /** This company's vendors by name, reset as each company is written. */
  let vendorsByName = new Map<string, string>();

  async function createTransactions(
    tx: Tx,
    propertyId: string,
    unitId: string | null,
    txns: CleanTransaction[]
  ) {
    for (const t of txns) {
      const txn = await tx.transaction.create({
        data: {
          propertyId,
          unitId,
          createdById: userId,
          type: t.type,
          date: t.date,
          amount: t.amount,
          detail: t.detail,
          note: t.note,
          category: t.category,
          vendorId: (t.vendorName && vendorsByName.get(t.vendorName)) || null,
        },
      });
      created.transactions += 1;

      if (t.attachments.length > 0) {
        await tx.attachment.createMany({
          data: t.attachments.map((a) => ({
            transactionId: txn.id,
            url: a.url,
            pathname: new URL(a.url).pathname.replace(/^\//, ""),
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
            uploadedById: userId,
          })),
        });
        created.attachments += t.attachments.length;
      }
    }
  }

  async function createRecurring(
    tx: Tx,
    propertyId: string,
    unitId: string | null,
    templates: CleanRecurring[]
  ) {
    if (templates.length === 0) return;
    await tx.recurringExpense.createMany({
      data: templates.map((r) => ({
        propertyId,
        unitId,
        createdById: userId,
        category: r.category,
        detail: r.detail,
        note: r.note,
        amount: r.amount,
        frequency: r.frequency,
        day: r.day,
        month: r.month,
        active: r.active,
      })),
    });
    created.recurring += templates.length;
  }

  /**
   * Returns a name -> id map for the tenants just written, which is how a
   * repair finds its reporter again: the backup carries the tenant's name,
   * because ids from the old database mean nothing in this one.
   *
   * Created one at a time rather than with createMany for that reason —
   * createMany doesn't hand back ids.
   */
  async function createTenants(
    tx: Tx,
    propertyId: string,
    unitId: string | null,
    tenants: CleanTenant[]
  ) {
    const byName = new Map<string, string>();
    for (const t of tenants) {
      const { notices, charges, rules, ...fields } = t;
      const row = await tx.tenant.create({
        data: { ...fields, propertyId, unitId, createdById: userId },
      });
      // Rules first, so their charges can point back at them, and their runs
      // with them — otherwise every rule charge ever deleted would be billed
      // again the first time this tenant's statement loaded.
      const ruleIds: string[] = [];
      for (const r of rules) {
        const { runs, ...ruleFields } = r;
        const made = await tx.tenantChargeRule.create({
          data: { ...ruleFields, tenantId: row.id, createdById: userId },
        });
        ruleIds.push(made.id);
        if (runs.length > 0) {
          await tx.tenantRuleRun.createMany({
            data: runs.map((run) => ({ ...run, ruleId: made.id })),
          });
        }
        created.rules += 1;
      }
      if (notices.length > 0) {
        await tx.tenantNotice.createMany({
          data: notices.map((n) => ({ ...n, tenantId: row.id, sentById: userId })),
        });
      }
      if (charges.length > 0) {
        await tx.tenantCharge.createMany({
          data: charges.map(({ rule, ...c }) => ({
            ...c,
            tenantId: row.id,
            raisedById: userId,
            ruleId: rule >= 0 ? (ruleIds[rule] ?? null) : null,
          })),
        });
        created.charges += charges.length;
      }
      created.tenants += 1;
      // First one wins: two tenants of the same name in one unit is a
      // coincidence, and guessing between them is worse than picking one.
      if (!byName.has(row.name)) byName.set(row.name, row.id);
    }
    return byName;
  }

  async function createRequests(
    tx: Tx,
    propertyId: string,
    unitId: string | null,
    requests: CleanRequest[],
    tenantsByName: Map<string, string>
  ) {
    for (const r of requests) {
      const row = await tx.maintenanceRequest.create({
        data: {
          propertyId,
          unitId,
          // A repair whose reporter is gone keeps its place in the history
          // with a null tenant rather than being dropped.
          tenantId: tenantsByName.get(r.tenantName) ?? null,
          vendorId: (r.vendorName && vendorsByName.get(r.vendorName)) || null,
          title: r.title,
          detail: r.detail,
          category: r.category,
          place: r.place,
          urgency: r.urgency,
          status: r.status,
          createdAt: r.createdAt,
          seenAt: r.seenAt,
          resolvedAt: r.resolvedAt,
        },
      });
      created.requests += 1;

      if (r.photos.length > 0) {
        await tx.maintenancePhoto.createMany({
          data: r.photos.map((a) => ({
            requestId: row.id,
            url: a.url,
            pathname: new URL(a.url).pathname.replace(/^\//, ""),
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
          })),
        });
      }
      if (r.updates.length > 0) {
        await tx.maintenanceUpdate.createMany({
          data: r.updates.map((u) => ({
            requestId: row.id,
            authorName: u.authorName,
            body: u.body,
            statusTo: u.statusTo,
            createdAt: u.createdAt,
          })),
        });
      }
    }
  }

  async function createDocuments(
    tx: Tx,
    companyId: string,
    propertyId: string | null,
    docs: CleanDocument[],
    tenantsByName: Map<string, string>
  ) {
    for (const { tenantName, vendorName, ...d } of docs) {
      const tenantId = (tenantName && tenantsByName.get(tenantName)) || null;
      await tx.document.create({
        data: {
          ...d,
          companyId,
          propertyId,
          tenantId,
          vendorId: (vendorName && vendorsByName.get(vendorName)) || null,
          // A tenant who didn't come back can't have anything shared with them.
          shared: d.shared && Boolean(tenantId),
          uploadedById: userId,
        },
      });
      created.documents += 1;
    }
  }

  async function createRentChanges(
    tx: Tx,
    propertyId: string,
    unitId: string | null,
    changes: CleanRentChange[]
  ) {
    if (changes.length === 0) return;
    await tx.rentChange.createMany({
      data: changes.map((c) => ({ ...c, propertyId, unitId, createdById: userId })),
    });
    created.rentChanges += changes.length;
  }

  await prisma.$transaction(async (tx) => {
    for (const company of parsed.companies) {
      const record = await tx.company.create({
        data: {
          name: uniqueName(company.name),
          contactPhone: company.contactPhone,
          contactEmail: company.contactEmail,
          members: { create: { userId, role: "owner" } },
        },
      });
      created.companies += 1;

      // The book goes in before any property, so the repairs and expenses
      // written below can name who did the work.
      vendorsByName = new Map();
      for (const v of company.vendors) {
        const made = await tx.vendor.create({
          data: { ...v, companyId: record.id, createdById: userId },
        });
        vendorsByName.set(made.name, made.id);
        created.vendors += 1;
      }

      for (const property of company.properties) {
        const prop = await tx.property.create({
          data: {
            companyId: record.id,
            createdById: userId,
            name: property.name,
            address: property.address,
            monthlyRent: property.monthlyRent,
            vacant: property.vacant,
          },
        });
        created.properties += 1;

        await createTransactions(tx, prop.id, null, property.transactions);
        await createRecurring(tx, prop.id, null, property.recurringExpenses);
        const propertyTenants = await createTenants(tx, prop.id, null, property.tenants);
        await createRentChanges(tx, prop.id, null, property.rentChanges);
        await createRequests(tx, prop.id, null, property.requests, propertyTenants);
        const everyTenant = new Map(propertyTenants);

        for (const unit of property.units) {
          const u = await tx.unit.create({
            data: {
              propertyId: prop.id,
              name: unit.name,
              monthlyRent: unit.monthlyRent,
              vacant: unit.vacant,
            },
          });
          created.units += 1;

          await createTransactions(tx, prop.id, u.id, unit.transactions);
          await createRecurring(tx, prop.id, u.id, unit.recurringExpenses);
          const unitTenants = await createTenants(tx, prop.id, u.id, unit.tenants);
          await createRentChanges(tx, prop.id, u.id, unit.rentChanges);
          await createRequests(tx, prop.id, u.id, unit.requests, unitTenants);
          for (const [name, id] of unitTenants) if (!everyTenant.has(name)) everyTenant.set(name, id);
        }
        // After the units, so a document for a tenant in Apt 2 can find them.
        await createDocuments(tx, record.id, prop.id, property.documents, everyTenant);
      }
      await createDocuments(tx, record.id, null, company.documents, new Map());
    }
  });

  return NextResponse.json({ ok: true, ...created });
}
