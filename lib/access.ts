import { prisma } from "@/lib/prisma";

/**
 * A team member's standing in one LLC, lowest first:
 *
 *   viewer — sees everything the team sees and changes nothing.
 *   member — records rent and expenses, manages tenants and repairs.
 *   owner  — also invites, removes people, and deletes things others rely on.
 *
 * Every check below defaults to "member", so a viewer is refused anything
 * that changes data unless a caller deliberately asks for no more than
 * "viewer" — which only read-only pages and GET routes do. A check that
 * forgets to say gets the safe answer.
 */
export type Role = "owner" | "member" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };

/** A stored role as one of the three; anything unrecognised is the least. */
export function roleOf(value: string | null | undefined): Role {
  return value === "owner" || value === "member" ? value : "viewer";
}

/** Whether a stored role meets the bar. */
export function hasRole(value: string | null | undefined, atLeast: Role): boolean {
  return RANK[roleOf(value)] >= RANK[atLeast];
}

export async function getMembership(userId: string, companyId: string) {
  return prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
  });
}

/** Membership for a company at the given standing or above, or null. */
export async function requireCompany(userId: string, companyId: string, role: Role = "member") {
  const membership = await getMembership(userId, companyId);
  if (!membership || !hasRole(membership.role, role)) return null;
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
export async function requireRecurring(userId: string, recurringId: string, role: Role = "member") {
  const template = await prisma.recurringExpense.findUnique({
    where: { id: recurringId },
    include: { property: true },
  });
  if (!template) return null;
  const membership = await requireCompany(userId, template.property.companyId, role);
  return membership ? template : null;
}

/** A tenant record the user can reach through one of their company teams. */
export async function requireTenant(userId: string, tenantId: string, role: Role = "member") {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { property: true },
  });
  if (!tenant) return null;
  const membership = await requireCompany(userId, tenant.property.companyId, role);
  return membership ? tenant : null;
}

/**
 * Every LLC the user can SEE, viewers included. For listing and reading
 * only — anything that writes scopes itself with writableCompanyIds.
 */
export async function companyIdsForUser(userId: string) {
  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    select: { companyId: true },
  });
  return memberships.map((m) => m.companyId);
}

/** The LLCs where the user may change things: member or owner, never viewer. */
export async function writableCompanyIds(userId: string) {
  const memberships = await prisma.companyMember.findMany({
    where: { userId, role: { in: ["member", "owner"] } },
    select: { companyId: true },
  });
  return memberships.map((m) => m.companyId);
}

/**
 * True when every one of the user's memberships is a viewer's — they can
 * change nothing anywhere. The interface uses it to leave out controls that
 * would only be refused; it says nothing to them about why.
 */
export async function isViewOnly(userId: string): Promise<boolean> {
  const memberships = await prisma.companyMember.findMany({ where: { userId }, select: { role: true } });
  return memberships.length > 0 && memberships.every((m) => !hasRole(m.role, "member"));
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

/** A depreciable asset on a property the user can reach; removing one takes an owner. */
export async function requireAsset(userId: string, assetId: string, role: Role = "member") {
  const asset = await prisma.depreciableAsset.findUnique({ where: { id: assetId }, include: { property: true } });
  if (!asset) return null;
  const membership = await requireCompany(userId, asset.property.companyId, role);
  return membership ? asset : null;
}

/** A valuation of a property the user can reach (a31). */
export async function requireValuation(userId: string, valuationId: string, role: Role = "member") {
  const valuation = await prisma.propertyValuation.findUnique({ where: { id: valuationId }, include: { property: true } });
  if (!valuation) return null;
  const membership = await requireCompany(userId, valuation.property.companyId, role);
  return membership ? valuation : null;
}

/** A listing the user can reach through one of their company teams (a27). */
export async function requireListing(userId: string, listingId: string, role: Role = "member") {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return null;
  return (await requireCompany(userId, listing.companyId, role)) ? listing : null;
}

/** An application to one of the user's companies' listings (a27). */
export async function requireApplication(userId: string, applicationId: string, role: Role = "member") {
  const app = await prisma.rentalApplication.findUnique({ where: { id: applicationId }, include: { listing: true } });
  if (!app) return null;
  return (await requireCompany(userId, app.listing.companyId, role)) ? app : null;
}
