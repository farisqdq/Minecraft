import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { describeAction, type AdminAction } from "@/lib/admin";
import { describeDevice, pushServiceName } from "@/lib/push-rules";

type Db = Prisma.TransactionClient | typeof prisma;

/** The signed-in admin, or null for anyone else — including every ordinary landlord. */
export async function requireAdmin() {
  const me = await getCurrentUser();
  return me && me.isAdmin ? me : null;
}

/**
 * Writes the audit line. Pass the transaction the change is made in, so a
 * change that commits is always logged and a log line never describes a
 * change that rolled back.
 */
export async function logAdmin(
  admin: { id: string; email: string },
  action: AdminAction,
  target: string,
  detail?: string | null,
  db: Db = prisma
) {
  await db.adminLog.create({
    data: { adminId: admin.id, adminEmail: admin.email, action, target, detail: detail || null },
  });
}

/**
 * Deletes an LLC and, once that has committed, the stored files nothing
 * else references: rows cascade on their own, blobs don't.
 */
export async function companyFileUrls(db: Db, companyId: string): Promise<string[]> {
  const [attachments, documents, photos, inspectionPhotos] = await Promise.all([
    db.attachment.findMany({ where: { transaction: { property: { companyId } } }, select: { url: true } }),
    db.document.findMany({ where: { companyId }, select: { url: true } }),
    db.maintenancePhoto.findMany({ where: { request: { property: { companyId } } }, select: { url: true } }),
    db.inspectionPhoto.findMany({
      where: { item: { inspection: { tenant: { property: { companyId } } } } },
      select: { url: true },
    }),
  ]);
  return [...attachments, ...documents, ...photos, ...inspectionPhotos].map((f) => f.url);
}

export type AdminAccount = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  isAdmin: boolean;
  twoFactor: boolean;
  memberships: { companyId: string; companyName: string; role: "owner" | "member"; since: string }[];
};

export type AdminCompany = {
  id: string;
  name: string;
  createdAt: string;
  properties: number;
  transactions: number;
  members: { userId: string; email: string; name: string; role: "owner" | "member"; since: string }[];
};

export type AdminLogEntry = {
  id: string;
  adminEmail: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
  text: string;
};

/** A phone or browser with notifications on, and whose it is. */
export type AdminDevice = {
  id: string;
  /** "user:<id>" or "tenant:<accountId>" — what "send to this person" targets. */
  owner: string;
  kind: "landlord" | "tenant";
  /** The account's name or email; a tenant's name. */
  who: string;
  /** The email, or for a tenant the property (and unit). */
  whoDetail: string;
  device: string;
  service: string;
  createdAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type AdminSnapshot = { accounts: AdminAccount[]; companies: AdminCompany[]; log: AdminLogEntry[]; devices: AdminDevice[] };

/** Every device with notifications on, newest first, with enough about its owner to recognise them. */
export async function adminDevices(): Promise<AdminDevice[]> {
  const rows = await prisma.pushSubscription.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      endpoint: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
      lastError: true,
      lastErrorAt: true,
      user: { select: { id: true, email: true, name: true } },
      tenantAccount: {
        select: {
          id: true,
          email: true,
          tenant: { select: { name: true, unit: { select: { name: true } }, property: { select: { name: true } } } },
        },
      },
    },
  });
  return rows.flatMap((r): AdminDevice[] => {
    const base = {
      id: r.id,
      device: describeDevice(r.userAgent),
      service: pushServiceName(r.endpoint),
      createdAt: r.createdAt.toISOString(),
      lastSuccessAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      lastError: r.lastError,
      lastErrorAt: r.lastErrorAt ? r.lastErrorAt.toISOString() : null,
    };
    if (r.user) {
      return [{ ...base, owner: `user:${r.user.id}`, kind: "landlord", who: r.user.name || r.user.email, whoDetail: r.user.name ? r.user.email : "Landlord account" }];
    }
    if (r.tenantAccount) {
      const t = r.tenantAccount.tenant;
      const place = [t.property.name, t.unit?.name].filter(Boolean).join(" · ");
      return [{ ...base, owner: `tenant:${r.tenantAccount.id}`, kind: "tenant", who: t.name, whoDetail: `Tenant · ${place}` }];
    }
    // No owner left (shouldn't happen: both relations cascade).
    return [];
  });
}

const role = (r: string) => (r === "owner" ? "owner" : "member") as "owner" | "member";

/**
 * Everything the panel shows, read fresh. Every admin action answers with a
 * new one of these rather than an "ok" — the panel then can't show a state
 * the database doesn't have, which this app has been bitten by before.
 */
export async function adminSnapshot(): Promise<AdminSnapshot> {
  const [users, companies, log, devices] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        isAdmin: true,
        totpSecret: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          select: { role: true, createdAt: true, company: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.company.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        members: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, email: true, name: true } } },
        },
        properties: { select: { _count: { select: { transactions: true } } } },
      },
    }),
    prisma.adminLog.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
    adminDevices(),
  ]);
  return {
    accounts: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? "",
      createdAt: u.createdAt.toISOString(),
      isAdmin: u.isAdmin,
      twoFactor: Boolean(u.totpSecret),
      memberships: u.memberships.map((m) => ({
        companyId: m.company.id,
        companyName: m.company.name,
        role: role(m.role),
        since: m.createdAt.toISOString(),
      })),
    })),
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt.toISOString(),
      properties: c.properties.length,
      transactions: c.properties.reduce((sum, p) => sum + p._count.transactions, 0),
      members: c.members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name ?? "",
        role: role(m.role),
        since: m.createdAt.toISOString(),
      })),
    })),
    log: log.map((l) => ({
      id: l.id,
      adminEmail: l.adminEmail,
      action: l.action,
      target: l.target,
      detail: l.detail ?? "",
      createdAt: l.createdAt.toISOString(),
      text: describeAction(l),
    })),
    devices,
  };
}
