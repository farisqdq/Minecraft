import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { BACKUP_FORMAT } from "../route";
import { normalizeCategory } from "@/lib/categories";

type Tx = Prisma.TransactionClient;

const MAX_COMPANIES = 100;
const MAX_PROPERTIES = 2000;
const MAX_UNITS = 5000;
const MAX_TRANSACTIONS = 50000;
const MAX_RECURRING = 5000;

type CleanAttachment = { url: string; filename: string; contentType: string; size: number };
type CleanTransaction = {
  type: string;
  date: Date;
  amount: number;
  detail: string | null;
  note: string | null;
  category: string | null;
  attachments: CleanAttachment[];
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
type CleanUnit = {
  name: string;
  monthlyRent: number;
  vacant: boolean;
  transactions: CleanTransaction[];
  recurringExpenses: CleanRecurring[];
};
type CleanProperty = {
  name: string;
  address: string | null;
  monthlyRent: number;
  vacant: boolean;
  transactions: CleanTransaction[];
  recurringExpenses: CleanRecurring[];
  units: CleanUnit[];
};
type CleanCompany = { name: string; properties: CleanProperty[] };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const bool = (v: unknown) => v === true;

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
        });
      }

      properties.push({
        name: propName,
        address: str(p.address, 250) || null,
        monthlyRent: num(p.monthlyRent),
        vacant: bool(p.vacant),
        transactions: parseTransactions(p.transactions),
        recurringExpenses: parseRecurring(p.recurringExpenses),
        units,
      });
    }

    companies.push({ name, properties });
  }

  if (companies.length === 0) throw new Error("That backup has no LLCs in it.");
  return { companies, propertyTotal, unitTotal, transactionTotal, recurringTotal };
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

  const created = { companies: 0, properties: 0, units: 0, transactions: 0, attachments: 0, recurring: 0 };

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

  await prisma.$transaction(async (tx) => {
    for (const company of parsed.companies) {
      const record = await tx.company.create({
        data: { name: uniqueName(company.name), members: { create: { userId, role: "owner" } } },
      });
      created.companies += 1;

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
        }
      }
    }
  });

  return NextResponse.json({ ok: true, ...created });
}
