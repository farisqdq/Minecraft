/**
 * The office assistant's lookups (lib/assistant): read-only, and every one
 * scoped to the companies the signed-in person is a member of. A property id
 * Claude passes that isn't in that scope matches nothing, the same as one
 * that doesn't exist.
 */
import { prisma } from "@/lib/prisma";
import { companyIdsForUser } from "@/lib/access";
import { balancesForTenants } from "@/lib/statements";
import {
  matches,
  parseRepairQuery,
  parseSearch,
  parseTransactionQuery,
  type ToolName,
} from "@/lib/assistant";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const cents = (n: number) => Math.round(n * 100) / 100;

async function scope(userId: string) {
  const companyIds = await companyIdsForUser(userId);
  const properties = await prisma.property.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true, name: true, address: true },
    orderBy: { name: "asc" },
  });
  return { companyIds, properties, byId: new Map(properties.map((p) => [p.id, p])) };
}

type Scope = Awaited<ReturnType<typeof scope>>;

/** A property id from Claude, if it's one of this person's; "" for all; null when it isn't theirs. */
function propertyFilter(s: Scope, id: string): string[] | null {
  if (!id) return s.properties.map((p) => p.id);
  return s.byId.has(id) ? [id] : null;
}

async function listProperties(s: Scope) {
  const rows = await prisma.property.findMany({
    where: { id: { in: s.properties.map((p) => p.id) } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      monthlyRent: true,
      vacant: true,
      units: { orderBy: { name: "asc" }, select: { id: true, name: true, monthlyRent: true, vacant: true } },
      tenants: {
        where: { active: true },
        orderBy: { name: "asc" },
        select: {
          name: true,
          unitId: true,
          phone: true,
          email: true,
          leaseStart: true,
          leaseEnd: true,
          dueDay: true,
          deposit: true,
        },
      },
    },
  });
  return rows.map((p) => {
    const unitName = new Map(p.units.map((u) => [u.id, u.name]));
    return {
      property_id: p.id,
      name: p.name,
      address: p.address || null,
      ...(p.units.length
        ? { units: p.units.map((u) => ({ name: u.name, monthly_rent: u.monthlyRent, vacant: u.vacant })) }
        : { monthly_rent: p.monthlyRent, vacant: p.vacant }),
      tenants: p.tenants.map((t) => ({
        name: t.name,
        unit: t.unitId ? unitName.get(t.unitId) ?? null : null,
        phone: t.phone || null,
        email: t.email || null,
        lease_start: day(t.leaseStart),
        lease_end: day(t.leaseEnd),
        rent_due_day: t.dueDay,
        deposit: t.deposit,
      })),
    };
  });
}

async function tenantBalances(s: Scope, input: unknown) {
  const search = parseSearch(input);
  const tenants = await prisma.tenant.findMany({
    where: { active: true, propertyId: { in: s.properties.map((p) => p.id) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, propertyId: true, unit: { select: { name: true } } },
  });
  const picked = tenants.filter((t) => {
    const p = s.byId.get(t.propertyId);
    return matches([t.name, p?.name, p?.address, t.unit?.name].filter(Boolean).join(" "), search);
  });
  if (picked.length > 60) {
    return { error: `${picked.length} tenants match — narrow it down with a name, property or unit.` };
  }
  const balances = await balancesForTenants(picked.map((t) => t.id));
  return picked.map((t) => {
    const b = balances[t.id];
    const p = s.byId.get(t.propertyId);
    return {
      tenant: t.name,
      property: p?.name,
      address: p?.address || null,
      unit: t.unit?.name ?? null,
      balance: b ? cents(b.balance) : null,
      behind_since: b?.behindSince || null,
      note: b ? b.problem || null : "No balance could be worked out for this tenant.",
    };
  });
}

async function findTransactions(s: Scope, input: unknown) {
  const q = parseTransactionQuery(input);
  const ids = propertyFilter(s, q.propertyId);
  if (!ids) return { error: "No property with that id. Use list_properties for the ids." };
  const where = {
    propertyId: { in: ids },
    ...(q.type ? { type: q.type } : {}),
    ...(q.from || q.to
      ? {
          date: {
            ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
            ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      date: true,
      type: true,
      amount: true,
      detail: true,
      note: true,
      category: true,
      appliesTo: true,
      propertyId: true,
      unit: { select: { name: true } },
      vendor: { select: { name: true } },
    },
    // Text search happens here rather than in SQL so it can ignore
    // punctuation the same way everywhere; a portfolio's ledger is small
    // enough to read in full.
    take: q.text ? 20000 : undefined,
  });
  const hits = q.text
    ? rows.filter((r) => matches([r.detail, r.note, r.category, r.vendor?.name].filter(Boolean).join(" "), q.text))
    : rows;
  const total = hits.reduce((sum, r) => sum + r.amount, 0);
  return {
    matched: hits.length,
    total: cents(total),
    showing: Math.min(q.limit, hits.length),
    rows: hits.slice(0, q.limit).map((r) => ({
      date: day(r.date),
      type: r.type,
      amount: r.amount,
      property: s.byId.get(r.propertyId)?.name,
      unit: r.unit?.name ?? null,
      description: r.detail || null,
      category: r.category || null,
      vendor: r.vendor?.name ?? null,
      for_month: r.appliesTo || null,
      note: r.note || null,
    })),
  };
}

async function repairRequests(s: Scope, input: unknown) {
  const q = parseRepairQuery(input);
  const ids = propertyFilter(s, q.propertyId);
  if (!ids) return { error: "No property with that id. Use list_properties for the ids." };
  const rows = await prisma.maintenanceRequest.findMany({
    where: { propertyId: { in: ids }, ...(q.open ? { status: { in: ["open", "seen", "scheduled"] } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      title: true,
      detail: true,
      category: true,
      urgency: true,
      status: true,
      place: true,
      createdAt: true,
      resolvedAt: true,
      propertyId: true,
      unit: { select: { name: true } },
      tenant: { select: { name: true } },
      vendor: { select: { name: true, phone: true } },
    },
  });
  return rows.map((r) => ({
    title: r.title,
    detail: r.detail.slice(0, 600),
    category: r.category,
    urgency: r.urgency,
    status: r.status,
    property: s.byId.get(r.propertyId)?.name,
    unit: r.unit?.name ?? null,
    where_in_unit: r.place || null,
    tenant: r.tenant?.name ?? null,
    vendor: r.vendor ? `${r.vendor.name}${r.vendor.phone ? `, ${r.vendor.phone}` : ""}` : null,
    reported: day(r.createdAt),
    resolved: day(r.resolvedAt),
  }));
}

async function findVendors(s: Scope, input: unknown) {
  const search = parseSearch(input);
  const rows = await prisma.vendor.findMany({
    where: { companyId: { in: s.companyIds } },
    orderBy: { name: "asc" },
    select: { name: true, trade: true, phone: true, email: true, note: true },
  });
  return rows
    .filter((v) => matches(`${v.name} ${v.trade}`, search))
    .slice(0, 80)
    .map((v) => ({ name: v.name, trade: v.trade, phone: v.phone || null, email: v.email || null, note: v.note || null }));
}

/** Runs one lookup and returns what Claude reads back, as JSON text. */
export async function runAssistantTool(userId: string, name: string, input: unknown): Promise<string> {
  const s = await scope(userId);
  let out: unknown;
  switch (name as ToolName) {
    case "list_properties":
      out = await listProperties(s);
      break;
    case "tenant_balances":
      out = await tenantBalances(s, input);
      break;
    case "find_transactions":
      out = await findTransactions(s, input);
      break;
    case "repair_requests":
      out = await repairRequests(s, input);
      break;
    case "find_vendors":
      out = await findVendors(s, input);
      break;
    default:
      out = { error: `There's no lookup called ${name}.` };
  }
  return JSON.stringify(out);
}
