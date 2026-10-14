import { prisma } from "@/lib/prisma";
import { KEEP_DAYS, describe, fillNames, type ActorKind, type RefKind } from "@/lib/activity";

export type ActivityEntry = {
  actorKind: ActorKind;
  actorId: string;
  actorEmail: string;
  actorName?: string | null;
  method: string;
  path: string;
  query?: string | null;
  ip?: string | null;
  device?: string | null;
};

/**
 * Writes one row. Never throws: a log that can't be written must not break
 * the page or the change it is describing. About one write in 500 also
 * clears rows past KEEP_DAYS, so the table stays a year deep without a job.
 */
export async function recordActivity(e: ActivityEntry): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actorKind: e.actorKind,
        actorId: e.actorId.slice(0, 64),
        actorEmail: (e.actorEmail || "").slice(0, 200),
        actorName: e.actorName ? e.actorName.slice(0, 200) : null,
        method: e.method.slice(0, 8),
        path: e.path.slice(0, 500),
        query: e.query || null,
        ip: e.ip || null,
        device: e.device || null,
      },
    });
    if (Math.random() < 0.002) {
      await prisma.activityLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 864e5) } } });
    }
  } catch (err) {
    console.error("activity log write failed", err);
  }
}

export type Person = {
  kind: ActorKind;
  id: string;
  email: string;
  name: string;
  last: string;
  week: number;
  total: number;
};

/** Everyone with any activity, most recently active first. */
export async function activityPeople(): Promise<Person[]> {
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const [all, week] = await Promise.all([
    prisma.activityLog.groupBy({ by: ["actorKind", "actorId"], _count: { _all: true }, _max: { createdAt: true } }),
    prisma.activityLog.groupBy({ by: ["actorKind", "actorId"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }),
  ]);
  const weekBy = new Map(week.map((w) => [`${w.actorKind}:${w.actorId}`, w._count._all]));
  // The newest row per person carries their current email and name.
  const latest = await Promise.all(
    all.map((g) =>
      prisma.activityLog.findFirst({
        where: { actorKind: g.actorKind, actorId: g.actorId },
        orderBy: { createdAt: "desc" },
        select: { actorEmail: true, actorName: true },
      }),
    ),
  );
  return all
    .map((g, i) => ({
      kind: g.actorKind as ActorKind,
      id: g.actorId,
      email: latest[i]?.actorEmail ?? "",
      name: latest[i]?.actorName ?? "",
      last: (g._max.createdAt ?? new Date(0)).toISOString(),
      week: weekBy.get(`${g.actorKind}:${g.actorId}`) ?? 0,
      total: g._count._all,
    }))
    .sort((a, b) => b.last.localeCompare(a.last));
}

export type ActivityRow = {
  id: string;
  at: string;
  text: string;
  change: boolean;
  path: string;
  ip: string;
  device: string;
};

export const PAGE_SIZE = 200;

/** One person's history, newest first, PAGE_SIZE at a time (pass the oldest `at` seen to get the next page). */
export async function activityFor(
  kind: ActorKind,
  id: string,
  opts: { before?: string; changesOnly?: boolean } = {},
): Promise<{ rows: ActivityRow[]; more: boolean }> {
  const before = opts.before ? new Date(opts.before) : null;
  const raw = await prisma.activityLog.findMany({
    where: {
      actorKind: kind,
      actorId: id,
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      ...(opts.changesOnly ? { method: { in: ["POST", "PUT", "PATCH", "DELETE", "EVENT"] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
  });
  const more = raw.length > PAGE_SIZE;
  const page = raw.slice(0, PAGE_SIZE);
  const described = page.map((r) => describe(r.method, r.path));

  // Look the named records up once each, whatever page they came from.
  const want: Record<RefKind, Set<string>> = { property: new Set(), tenant: new Set(), unit: new Set(), company: new Set(), vendor: new Set() };
  for (const d of described) for (const ref of d.refs) want[ref.kind].add(ref.id);
  const ids = (k: RefKind) => [...want[k]];
  const [props, tenants, units, companies, vendors] = await Promise.all([
    want.property.size ? prisma.property.findMany({ where: { id: { in: ids("property") } }, select: { id: true, name: true } }) : [],
    want.tenant.size ? prisma.tenant.findMany({ where: { id: { in: ids("tenant") } }, select: { id: true, name: true } }) : [],
    want.unit.size
      ? prisma.unit.findMany({ where: { id: { in: ids("unit") } }, select: { id: true, name: true, property: { select: { name: true } } } })
      : [],
    want.company.size ? prisma.company.findMany({ where: { id: { in: ids("company") } }, select: { id: true, name: true } }) : [],
    want.vendor.size ? prisma.vendor.findMany({ where: { id: { in: ids("vendor") } }, select: { id: true, name: true } }) : [],
  ]);
  const names = new Map<string, string>();
  for (const p of props) names.set(`property:${p.id}`, p.name);
  for (const t of tenants) names.set(`tenant:${t.id}`, t.name);
  for (const u of units) names.set(`unit:${u.id}`, `${u.name} (${u.property.name})`);
  for (const c of companies) names.set(`company:${c.id}`, c.name);
  for (const v of vendors) names.set(`vendor:${v.id}`, v.name);

  const rows = page.map((r, i) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    text: fillNames(described[i].text, names) + (r.query && !described[i].change ? ` · ${[...new URLSearchParams(r.query)].map(([k, v]) => `${k}: ${v}`).join(", ")}` : ""),
    change: described[i].change || r.method === "EVENT",
    path: r.path,
    ip: r.ip ?? "",
    device: r.device ?? "",
  }));
  return { rows, more };
}
