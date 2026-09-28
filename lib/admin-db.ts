import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { describeAction, type AdminAction } from "@/lib/admin";

/** The signed-in admin, or null for anyone else — including every ordinary landlord. */
export async function requireAdmin() {
  const me = await getCurrentUser();
  return me && me.isAdmin ? me : null;
}

export async function logAdmin(
  admin: { id: string; email: string },
  action: AdminAction,
  target: string,
  detail?: string | null
) {
  await prisma.adminLog.create({
    data: { adminId: admin.id, adminEmail: admin.email, action, target, detail: detail || null },
  });
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

export type AdminSnapshot = { accounts: AdminAccount[]; companies: AdminCompany[]; log: AdminLogEntry[] };

const role = (r: string) => (r === "owner" ? "owner" : "member") as "owner" | "member";

/**
 * Everything the panel shows, read fresh. Every admin action answers with a
 * new one of these rather than an "ok" — the panel then can't show a state
 * the database doesn't have, which this app has been bitten by before.
 */
export async function adminSnapshot(): Promise<AdminSnapshot> {
  const [users, companies, log] = await Promise.all([
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
  };
}
