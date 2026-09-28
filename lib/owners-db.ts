import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { emailConfigured, sendEmail } from "@/lib/email";
import { hashToken, plausibleToken } from "@/lib/password-reset";
import {
  assignableIds,
  combineStatements,
  newOwnerInviteToken,
  ownerAcceptLink,
  ownerInviteEmail,
  ownerInviteIsLive,
  ownerStatementEmail,
  ownerStatementKey,
  ownerStatementLink,
  parsePropertyIds,
  serializePropertyIds,
  statementFor,
  statementMonthDue,
  type OwnerStatement,
  type OwnerTxn,
} from "@/lib/owners";

/**
 * The database half of the owner portal: inviting, assigning and revoking
 * on the landlord side; reading a scoped ledger on the owner side; and the
 * monthly statement email. The arithmetic is in lib/owners.ts.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/* ---------- Landlord side ---------- */

export type OwnerDTO = {
  id: string;
  email: string;
  name: string;
  monthlyEmail: boolean;
  /** Empty until they've accepted an invite (or after a restore from backup). */
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string;
  /** Their properties in this company only. */
  propertyIds: string[];
};

export type OwnerInviteDTO = {
  id: string;
  email: string;
  name: string;
  propertyIds: string[];
  createdAt: string;
  expiresAt: string;
};

export type CompanyOwnersSnapshot = {
  companyId: string;
  companyName: string;
  properties: { id: string; name: string }[];
  owners: OwnerDTO[];
  invites: OwnerInviteDTO[];
  emailConfigured: boolean;
};

/** Everything the "Property owners" page shows for one LLC. */
export async function companyOwnersSnapshot(companyId: string): Promise<CompanyOwnersSnapshot | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      properties: {
        select: { id: true, name: true, ownerAccess: { include: { owner: true } } },
        orderBy: { createdAt: "asc" },
      },
      ownerInvites: { where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!company) return null;

  const owners = new Map<string, OwnerDTO>();
  for (const p of company.properties) {
    for (const a of p.ownerAccess) {
      let dto = owners.get(a.ownerId);
      if (!dto) {
        dto = {
          id: a.owner.id,
          email: a.owner.email,
          name: a.owner.name,
          monthlyEmail: a.owner.monthlyEmail,
          hasPassword: Boolean(a.owner.passwordHash),
          createdAt: iso(a.owner.createdAt),
          lastLoginAt: iso(a.owner.lastLoginAt),
          propertyIds: [],
        };
        owners.set(a.ownerId, dto);
      }
      dto.propertyIds.push(p.id);
    }
  }
  const validIds = new Set(company.properties.map((p) => p.id));
  return {
    companyId: company.id,
    companyName: company.name,
    properties: company.properties.map((p) => ({ id: p.id, name: p.name })),
    owners: Array.from(owners.values()).sort((a, b) => a.email.localeCompare(b.email)),
    invites: company.ownerInvites.map((i) => ({
      id: i.id,
      email: i.email,
      name: i.name ?? "",
      propertyIds: parsePropertyIds(i.propertyIds).filter((id) => validIds.has(id)),
      createdAt: iso(i.createdAt),
      expiresAt: iso(i.expiresAt),
    })),
    emailConfigured: emailConfigured(),
  };
}

export type InviteResult = {
  invite: OwnerInviteDTO;
  /** The link, for the landlord to hand over when email isn't set up or didn't go. */
  link: string;
  sent: boolean;
  reason: "" | "unconfigured" | "failed";
};

/**
 * Invite an email address to some of a company's properties. A fresh
 * token every time; any older unaccepted invite for the same address in
 * this company is retired, so re-inviting with a different set of
 * properties can't leave two live links around.
 */
export async function createOwnerInvite(opts: {
  companyId: string;
  email: string;
  name: string;
  propertyIds: unknown;
  invitedById: string;
  origin: string;
}): Promise<InviteResult | { error: string }> {
  const company = await prisma.company.findUnique({
    where: { id: opts.companyId },
    select: { name: true, properties: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!company) return { error: "Not found" };
  const ids = assignableIds(
    opts.propertyIds,
    company.properties.map((p) => p.id)
  );
  if (ids.length === 0) return { error: "Pick at least one property." };

  const { token, tokenHash, expiresAt } = newOwnerInviteToken();
  const [, invite] = await prisma.$transaction([
    prisma.propertyOwnerInvite.deleteMany({ where: { companyId: opts.companyId, email: opts.email, acceptedAt: null } }),
    prisma.propertyOwnerInvite.create({
      data: {
        companyId: opts.companyId,
        email: opts.email,
        name: opts.name || null,
        tokenHash,
        propertyIds: serializePropertyIds(ids),
        invitedById: opts.invitedById,
        expiresAt,
      },
    }),
  ]);
  return deliverInvite(invite, token, opts.origin, company.name, company.properties);
}

/** A new link for an invite that's still waiting; the old link stops working. */
export async function resendOwnerInvite(
  companyId: string,
  inviteId: string,
  origin: string
): Promise<InviteResult | { error: string }> {
  const existing = await prisma.propertyOwnerInvite.findUnique({
    where: { id: inviteId },
    include: { company: { select: { name: true, properties: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } } } },
  });
  if (!existing || existing.companyId !== companyId || existing.acceptedAt) return { error: "Not found" };
  const { token, tokenHash, expiresAt } = newOwnerInviteToken();
  const invite = await prisma.propertyOwnerInvite.update({ where: { id: inviteId }, data: { tokenHash, expiresAt } });
  return deliverInvite(invite, token, origin, existing.company.name, existing.company.properties);
}

async function deliverInvite(
  invite: { id: string; email: string; name: string | null; propertyIds: string; createdAt: Date; expiresAt: Date },
  token: string,
  origin: string,
  companyName: string,
  properties: { id: string; name: string }[]
): Promise<InviteResult> {
  const ids = parsePropertyIds(invite.propertyIds);
  const link = ownerAcceptLink(origin, token);
  const message = ownerInviteEmail({
    link,
    companyName,
    propertyNames: properties.filter((p) => ids.includes(p.id)).map((p) => p.name),
  });
  const result = await sendEmail({ to: invite.email, ...message });
  return {
    invite: {
      id: invite.id,
      email: invite.email,
      name: invite.name ?? "",
      propertyIds: ids,
      createdAt: iso(invite.createdAt),
      expiresAt: iso(invite.expiresAt),
    },
    link,
    sent: result.sent,
    reason: result.sent ? "" : result.reason,
  };
}

export async function revokeOwnerInvite(companyId: string, inviteId: string): Promise<boolean> {
  const r = await prisma.propertyOwnerInvite.deleteMany({ where: { id: inviteId, companyId } });
  return r.count > 0;
}

/**
 * Set which of this company's properties an owner may read. Only this
 * company's rows are touched: an owner with access in another LLC keeps
 * it, because that LLC's team gave it and only they can take it away.
 */
export async function setOwnerAssignments(
  companyId: string,
  ownerId: string,
  propertyIds: unknown
): Promise<{ propertyIds: string[] } | { error: string }> {
  const properties = await prisma.property.findMany({
    where: { companyId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = properties.map((p) => p.id);
  const wanted = assignableIds(propertyIds, companyIds);
  if (wanted.length === 0) return { error: "Pick at least one property, or revoke their access instead." };

  const owner = await prisma.propertyOwner.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!owner) return { error: "Not found" };

  await prisma.$transaction([
    prisma.propertyOwnerAccess.deleteMany({
      where: { ownerId, propertyId: { in: companyIds.filter((id) => !wanted.includes(id)) } },
    }),
    prisma.propertyOwnerAccess.createMany({
      data: wanted.map((propertyId) => ({ ownerId, propertyId })),
      skipDuplicates: true,
    }),
  ]);
  return { propertyIds: wanted };
}

/**
 * Take an owner's access to this company's properties away. When that
 * leaves them with nothing anywhere, the login goes too — there is nothing
 * for it to see, and a re-invite starts them clean. Any live invite for
 * the address in this company is retired as well.
 */
export async function revokeOwner(companyId: string, ownerId: string): Promise<{ deletedAccount: boolean } | null> {
  const owner = await prisma.propertyOwner.findUnique({ where: { id: ownerId }, select: { id: true, email: true } });
  if (!owner) return null;
  await prisma.$transaction([
    prisma.propertyOwnerAccess.deleteMany({ where: { ownerId, property: { companyId } } }),
    prisma.propertyOwnerInvite.deleteMany({ where: { companyId, email: owner.email, acceptedAt: null } }),
  ]);
  const remaining = await prisma.propertyOwnerAccess.count({ where: { ownerId } });
  if (remaining === 0) {
    await prisma.propertyOwner.delete({ where: { id: ownerId } });
    return { deletedAccount: true };
  }
  // Their scope shrank: end every session so a page left open can't keep
  // showing what it already loaded. They can sign straight back in.
  await prisma.propertyOwner.update({ where: { id: ownerId }, data: { sessionVersion: { increment: 1 } } });
  return { deletedAccount: false };
}

/* ---------- Accepting an invite ---------- */

export type InvitePreview = {
  email: string;
  name: string;
  companyName: string;
  propertyNames: string[];
  /** Whether an account for this email already exists and has a password — they'll sign in to accept. */
  existing: boolean;
};

/** The live invite behind a token, or null for anything else. */
export async function inviteByToken(token: unknown) {
  if (!plausibleToken(token)) return null;
  const invite = await prisma.propertyOwnerInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { company: { select: { name: true, properties: { select: { id: true, name: true } } } } },
  });
  if (!invite || !ownerInviteIsLive(invite)) return null;
  return invite;
}

export async function previewInvite(token: unknown): Promise<InvitePreview | null> {
  const invite = await inviteByToken(token);
  if (!invite) return null;
  const ids = parsePropertyIds(invite.propertyIds);
  const owner = await prisma.propertyOwner.findUnique({ where: { email: invite.email }, select: { passwordHash: true, name: true } });
  return {
    email: invite.email,
    name: owner?.name || invite.name || "",
    companyName: invite.company.name,
    propertyNames: invite.company.properties.filter((p) => ids.includes(p.id)).map((p) => p.name),
    existing: Boolean(owner?.passwordHash),
  };
}

/**
 * Turn an invite into access. A new email gets an account with the
 * password given; an email that already has a login proves it's them by
 * giving that password, and the properties are added to what they had.
 * Either way the invite is spent and can't be used twice.
 */
export async function acceptOwnerInvite(opts: {
  token: unknown;
  name: string;
  password: string;
}): Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }> {
  const invite = await inviteByToken(opts.token);
  if (!invite) {
    return { ok: false, status: 404, error: "That link isn't valid — it may have been used already or expired. Ask for a new one." };
  }
  const validIds = new Set(invite.company.properties.map((p) => p.id));
  const ids = parsePropertyIds(invite.propertyIds).filter((id) => validIds.has(id));
  if (ids.length === 0) return { ok: false, status: 410, error: "The properties on this invite no longer exist." };

  const existing = await prisma.propertyOwner.findUnique({ where: { email: invite.email } });
  let ownerId: string;
  if (existing?.passwordHash) {
    if (!(await bcrypt.compare(opts.password, existing.passwordHash))) {
      return { ok: false, status: 403, error: "You already have an owner login for this email. Enter its password to add these properties." };
    }
    ownerId = existing.id;
  } else {
    const passwordHash = await bcrypt.hash(opts.password, 12);
    const name = opts.name || invite.name || invite.email.split("@")[0];
    const row = existing
      ? await prisma.propertyOwner.update({ where: { id: existing.id }, data: { passwordHash, name } })
      : await prisma.propertyOwner.create({ data: { email: invite.email, name, passwordHash } });
    ownerId = row.id;
  }

  // The invite is claimed with a conditional update, so two submissions
  // landing together can't both spend it.
  const claimed = await prisma.propertyOwnerInvite.updateMany({
    where: { id: invite.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, status: 409, error: "That link was just used. Sign in instead." };
  await prisma.propertyOwnerAccess.createMany({
    data: ids.map((propertyId) => ({ ownerId, propertyId })),
    skipDuplicates: true,
  });
  return { ok: true, email: invite.email };
}

/* ---------- Owner side ---------- */

/** The ledger for some properties, in the shape the arithmetic wants; optionally only from a day on. */
export async function ownerTransactions(propertyIds: string[], from?: Date): Promise<OwnerTxn[]> {
  if (propertyIds.length === 0) return [];
  const rows = await prisma.transaction.findMany({
    where: { propertyId: { in: propertyIds }, ...(from ? { date: { gte: from } } : {}) },
    select: { propertyId: true, type: true, date: true, amount: true, category: true, moveOutId: true },
    orderBy: { date: "asc" },
  });
  return rows.map((t) => ({
    propertyId: t.propertyId,
    type: t.type,
    date: t.date.toISOString().slice(0, 10),
    amount: t.amount,
    category: t.category ?? "",
    // Deposit money kept at a move-out is income, but not rent.
    otherIncome: Boolean(t.moveOutId),
  }));
}

export type PropertyStatement = {
  id: string;
  name: string;
  address: string;
  companyName: string;
  statement: OwnerStatement;
};

/** One month's statement per property, and the lot combined. */
export async function ownerStatements(
  properties: { id: string; name: string; address: string; companyName: string }[],
  month: string
): Promise<{ properties: PropertyStatement[]; combined: OwnerStatement }> {
  const txns = await ownerTransactions(
    properties.map((p) => p.id),
    new Date(`${month}-01T00:00:00.000Z`)
  );
  const perProperty = properties.map((p) => ({
    ...p,
    statement: statementFor(
      txns.filter((t) => t.propertyId === p.id),
      month
    ),
  }));
  return { properties: perProperty, combined: combineStatements(perProperty.map((p) => p.statement), month) };
}

/* ---------- The monthly email ---------- */

const isUniqueClash = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export type OwnerStatementsReport = {
  month: string | null;
  owners: number;
  sent: number;
  failed: number;
  skipped: number;
  duplicate: number;
};

/**
 * Email every owner who asked for it that last month's statement is
 * ready. Called from the daily reminders run; safe to call again, because
 * each email is claimed in ReminderSent under a key for the owner and the
 * month before it goes, and a second run finds the claim and stops.
 */
export async function runOwnerStatements(now: Date, origin: string): Promise<OwnerStatementsReport> {
  const month = statementMonthDue(now);
  const report: OwnerStatementsReport = { month, owners: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  if (!month) return report;

  const owners = await prisma.propertyOwner.findMany({
    where: { monthlyEmail: true, access: { some: {} }, NOT: { passwordHash: "" } },
    include: {
      access: {
        include: {
          property: { select: { id: true, name: true, address: true, companyId: true, company: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  for (const owner of owners) {
    report.owners += 1;
    const key = ownerStatementKey(owner.id, month);
    // The log needs one company to hang the row off; the first property's
    // is as good as any when their properties span more than one.
    const companyId = owner.access[0].property.companyId;

    let claim: { id: string };
    try {
      claim = await prisma.reminderSent.create({
        data: { companyId, kind: "owner-statement", key, channel: "email", to: owner.email },
        select: { id: true },
      });
    } catch (err) {
      if (isUniqueClash(err)) {
        report.duplicate += 1;
        continue;
      }
      throw err;
    }

    const { properties, combined } = await ownerStatements(
      owner.access.map((a) => ({
        id: a.property.id,
        name: a.property.name,
        address: a.property.address ?? "",
        companyName: a.property.company.name,
      })),
      month
    );
    const message = ownerStatementEmail({
      name: owner.name,
      month,
      link: ownerStatementLink(origin, month),
      properties: properties.map((p) => ({ name: p.name, statement: p.statement })),
      combined,
    });
    const r = await sendEmail({ to: owner.email, ...message });
    const status = r.sent ? "sent" : r.reason === "unconfigured" ? "skipped" : "failed";
    const detail = r.sent ? null : r.reason === "unconfigured" ? "email isn't set up" : "the mail service refused it";
    await prisma.reminderSent.update({ where: { id: claim.id }, data: { status, detail } });
    report[status] += 1;
  }
  return report;
}
