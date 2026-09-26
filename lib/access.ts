import { prisma } from "@/lib/prisma";

export type Role = "owner" | "member";

export async function getMembership(userId: string, companyId: string) {
  return prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
}

/** Membership for a company, or null when the user isn't on its team. */
export async function requireCompany(userId: string, companyId: string, role: Role = "member") {
  const membership = await getMembership(userId, companyId);
  if (!membership) return null;
  if (role === "owner" && membership.role !== "owner") return null;
  return membership;
}

/**
 * A property the user can reach through one of their company teams.
 *
 * `role` raises the bar: the team page promises a member can "record rent and
 * expenses" while only an owner "can also invite and delete", so anything that
 * destroys records other people rely on asks for "owner".
 */
export async function requireProperty(userId: string, propertyId: string, role: Role = "member") {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return null;
  const membership = await requireCompany(userId, property.companyId, role);
  return membership ? property : null;
}

/** A unit the user can reach through one of their company teams. */
export async function requireUnit(userId: string, unitId: string, role: Role = "member") {
  const unit = await prisma.unit.findUnique({ where: { id: unitId }, include: { property: true } });
  if (!unit) return null;
  const membership = await requireCompany(userId, unit.property.companyId, role);
  return membership ? unit : null;
}

/** A recurring expense template the user can reach through one of their company teams. */
export async function requireRecurring(userId: string, recurringId: string) {
  const template = await prisma.recurringExpense.findUnique({
    where: { id: recurringId },
    include: { property: true },
  });
  if (!template) return null;
  const membership = await getMembership(userId, template.property.companyId);
  return membership ? template : null;
}

/** A tenant record the user can reach through one of their company teams. */
export async function requireTenant(userId: string, tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { property: true },
  });
  if (!tenant) return null;
  const membership = await getMembership(userId, tenant.property.companyId);
  return membership ? tenant : null;
}

export async function companyIdsForUser(userId: string) {
  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    select: { companyId: true },
  });
  return memberships.map((m) => m.companyId);
}

/**
 * A vendor in the book of one of the user's companies.
 *
 * Deleting one takes it off every repair and expense it was on, so that
 * needs "owner" like the other destructive actions; adding and editing only
 * need to be on the team.
 */
export async function requireVendor(userId: string, vendorId: string, role: Role = "member") {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return null;
  const membership = await requireCompany(userId, vendor.companyId, role);
  return membership ? vendor : null;
}

/**
 * A document in one of the user's companies. Deleting one destroys the only
 * copy of the file, so it takes an owner, like the other destructive actions.
 */
export async function requireDocument(userId: string, documentId: string, role: Role = "member") {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return null;
  const membership = await requireCompany(userId, doc.companyId, role);
  return membership ? doc : null;
}

/**
 * A loan on a property the user can reach. Recording and undoing payments
 * is everyday bookkeeping, open to the team; removing the loan record takes
 * an owner, like removing anything else people rely on.
 */
export async function requireLoan(userId: string, loanId: string, role: Role = "member") {
  const loan = await prisma.loan.findUnique({ where: { id: loanId }, include: { property: true } });
  if (!loan) return null;
  const membership = await requireCompany(userId, loan.property.companyId, role);
  return membership ? loan : null;
}
