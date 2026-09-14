import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { BACKUP_FORMAT } from "../route";

const MAX_COMPANIES = 100;
const MAX_PROPERTIES = 2000;
const MAX_TRANSACTIONS = 50000;

type CleanTransaction = {
  type: string;
  date: Date;
  amount: number;
  detail: string | null;
  note: string | null;
};
type CleanProperty = {
  name: string;
  address: string | null;
  monthlyRent: number;
  transactions: CleanTransaction[];
};
type CleanCompany = { name: string; properties: CleanProperty[] };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
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
  let transactionTotal = 0;

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

      const transactions: CleanTransaction[] = [];
      for (const rawTxn of Array.isArray(p.transactions) ? p.transactions : []) {
        const t = (rawTxn ?? {}) as Record<string, unknown>;
        const date = typeof t.date === "string" ? new Date(t.date) : null;
        const amount = num(t.amount);
        if (!date || isNaN(date.getTime()) || amount <= 0) continue;
        if (++transactionTotal > MAX_TRANSACTIONS) throw new Error("That backup is too large to import.");

        transactions.push({
          type: t.type === "expense" ? "expense" : "rent",
          date,
          amount,
          detail: str(t.detail, 200) || null,
          note: str(t.note, 500) || null,
        });
      }

      properties.push({
        name: propName,
        address: str(p.address, 250) || null,
        monthlyRent: num(p.monthlyRent),
        transactions,
      });
    }

    companies.push({ name, properties });
  }

  if (companies.length === 0) throw new Error("That backup has no LLCs in it.");
  return { companies, propertyTotal, transactionTotal };
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

  const created = { companies: 0, properties: 0, transactions: 0 };

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
          },
        });
        created.properties += 1;

        if (property.transactions.length > 0) {
          await tx.transaction.createMany({
            data: property.transactions.map((t) => ({
              propertyId: prop.id,
              createdById: userId,
              type: t.type,
              date: t.date,
              amount: t.amount,
              detail: t.detail,
              note: t.note,
            })),
          });
          created.transactions += property.transactions.length;
        }
      }
    }
  });

  return NextResponse.json({ ok: true, ...created });
}
