/**
 * Listings and applications, in the database.
 */

import type { Listing, Prisma, RentalApplication } from "@prisma/client";
import { prisma } from "./prisma";
import { clearVacancy } from "./vacancy-db";
import { monthKeyOf, rentForMonth, serializeRentChange } from "./rent";
import { placeRent, writeRentFrom } from "./renewals-db";
import { landlordRecipients, notify } from "./reminders-db";
import { reminderKey } from "./reminders";
import { money } from "./money";
import { isThrottled, recordFailure } from "./throttle";
import { newListingCode, type ApplicationInput, type ApplicationStatus, type ListingInput } from "./listings";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export type ListingDTO = {
  id: string;
  companyId: string;
  propertyId: string;
  unitId: string | null;
  code: string;
  headline: string;
  description: string;
  rent: number;
  deposit: number;
  availableOn: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pets: string;
  photoIds: string[];
  open: boolean;
  closedAt: string;
  createdAt: string;
  /** Applications that nobody has decided yet. */
  waiting: number;
  total: number;
};

export function serializeListing(l: Listing & { applications?: { status: string }[] }): ListingDTO {
  const apps = l.applications ?? [];
  return {
    id: l.id,
    companyId: l.companyId,
    propertyId: l.propertyId,
    unitId: l.unitId,
    code: l.code,
    headline: l.headline,
    description: l.description ?? "",
    rent: l.rent,
    deposit: l.deposit,
    availableOn: day(l.availableOn),
    beds: l.beds,
    baths: l.baths,
    sqft: l.sqft,
    pets: l.pets ?? "",
    photoIds: l.photoIds,
    open: l.open,
    closedAt: l.closedAt ? l.closedAt.toISOString() : "",
    createdAt: l.createdAt.toISOString(),
    waiting: apps.filter((a) => a.status === "new" || a.status === "reviewing").length,
    total: apps.length,
  };
}

export type ApplicationDTO = {
  id: string;
  listingId: string;
  name: string;
  email: string;
  phone: string;
  moveIn: string;
  occupants: number;
  income: number | null;
  employer: string;
  currentAddress: string;
  landlordName: string;
  landlordPhone: string;
  pets: string;
  message: string;
  status: ApplicationStatus;
  tenantId: string | null;
  decidedAt: string;
  createdAt: string;
};

export function serializeApplication(a: RentalApplication): ApplicationDTO {
  return {
    id: a.id,
    listingId: a.listingId,
    name: a.name,
    email: a.email,
    phone: a.phone,
    moveIn: day(a.moveIn),
    occupants: a.occupants,
    income: a.income,
    employer: a.employer ?? "",
    currentAddress: a.currentAddress ?? "",
    landlordName: a.landlordName ?? "",
    landlordPhone: a.landlordPhone ?? "",
    pets: a.pets ?? "",
    message: a.message ?? "",
    status: (["new", "reviewing", "approved", "declined"].includes(a.status) ? a.status : "new") as ApplicationStatus,
    tenantId: a.tenantId,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : "",
    createdAt: a.createdAt.toISOString(),
  };
}

/** Listing fields as the database stores them. */
export function listingData(v: ListingInput) {
  return {
    headline: v.headline,
    description: v.description || null,
    rent: v.rent,
    deposit: v.deposit,
    availableOn: v.availableOn ? new Date(`${v.availableOn}T00:00:00Z`) : null,
    beds: v.beds,
    baths: v.baths,
    sqft: v.sqft,
    pets: v.pets || null,
    photoIds: v.photoIds,
  };
}

/** Only photos of this property that are in the filing cabinet as photos make it onto a listing. */
export async function allowedPhotoIds(propertyId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const docs = await prisma.document.findMany({
    where: { id: { in: ids }, propertyId, kind: "Photo" },
    select: { id: true },
  });
  const ok = new Set(docs.map((d) => d.id));
  return ids.filter((id) => ok.has(id));
}

export async function createListing(userId: string, property: { id: string; companyId: string }, unitId: string | null, v: ListingInput) {
  const photoIds = await allowedPhotoIds(property.id, v.photoIds);
  // A clash on a ten-character code is vanishingly rare; one retry covers it.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.listing.create({
        data: { ...listingData(v), photoIds, code: newListingCode(), companyId: property.companyId, propertyId: property.id, unitId, createdById: userId },
        include: { applications: { select: { status: true } } },
      });
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002" || attempt > 1) throw e;
    }
  }
}

/** What the public page shows: only an open listing, and nothing about the team. */
export async function publicListing(code: string) {
  const l = await prisma.listing.findUnique({
    where: { code },
    include: {
      property: { select: { name: true, address: true } },
      unit: { select: { name: true } },
      company: { select: { name: true, contactPhone: true, contactEmail: true } },
    },
  });
  return l && l.open ? l : null;
}

/** Applications from one address before it waits a while. A family applying for two places is two. */
const MAX_APPLICATIONS_PER_IP = 6;
/** More than this on one listing is a flood, not interest. */
const MAX_APPLICATIONS_PER_LISTING = 300;

export async function submitApplication(
  code: string,
  input: ApplicationInput,
  ip: string | null,
  origin: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const listing = await publicListing(code);
  if (!listing) return { ok: false, error: "This listing isn't taking applications any more.", status: 404 };
  const key = ip ? `apply:${ip}` : null;
  if (await isThrottled([key])) {
    return { ok: false, error: "Too many applications from here just now. Try again in a few minutes.", status: 429 };
  }
  const count = await prisma.rentalApplication.count({ where: { listingId: listing.id } });
  if (count >= MAX_APPLICATIONS_PER_LISTING) return { ok: false, error: "This listing isn't taking more applications.", status: 409 };

  const app = await prisma.rentalApplication.create({
    data: { ...input, moveIn: input.moveIn ? new Date(`${input.moveIn}T00:00:00Z`) : null, listingId: listing.id },
  });
  await recordFailure([{ key, max: MAX_APPLICATIONS_PER_IP }]);

  // The team hears at once, by email and push, once per application.
  const place = [listing.property.name, listing.unit?.name].filter(Boolean).join(" — ");
  await notify({
    companyId: listing.companyId,
    kind: "application",
    key: reminderKey.application(app.id),
    recipients: await landlordRecipients(listing.companyId),
    channels: { email: true, push: true },
    notification: {
      subject: `New application for ${place}: ${input.name}`,
      text: [
        `${input.name} applied for ${place} (${money(listing.rent)} a month).`,
        input.income !== null ? `Monthly income: ${money(input.income)}.` : "",
        input.moveIn ? `Wants to move in ${input.moveIn}.` : "",
        "",
        `Review it: ${origin}/dashboard/listings#application-${app.id}`,
      ]
        .filter((l, i, all) => l || all[i - 1])
        .join("\n"),
      short: `${input.name} applied for ${place}.`,
      url: `${origin}/dashboard/listings#application-${app.id}`,
      tag: `application-${listing.id}`,
    },
  }).catch((err) => console.error("Application notify", err));
  return { ok: true };
}

export type ApprovalTerms = { leaseStart: string; leaseEnd: string; deposit: number; dueDay: number };

/**
 * Turns an application into a tenant: the same as adding one by hand (the
 * place stops being vacant), with the listing's rent written into the rent
 * history from the month the lease starts when it differs from what the
 * place was asking. The listing closes; other applications stay as they are
 * for the team to answer.
 */
export async function approveApplication(userId: string, applicationId: string, terms: ApprovalTerms) {
  return prisma.$transaction(async (tx) => {
    const app = await tx.rentalApplication.findUnique({ where: { id: applicationId }, include: { listing: true } });
    if (!app) return { ok: false as const, error: "That application is gone." };
    // Claimed first, so two approvals at once can't make two tenants: the
    // second waits on this row and then finds it already approved.
    const claimed = await tx.rentalApplication.updateMany({ where: { id: app.id, status: { not: "approved" } }, data: { status: "approved" } });
    if (claimed.count === 0) return { ok: false as const, error: `${app.name} is already approved.` };
    const { listing } = app;
    const place = { propertyId: listing.propertyId, unitId: listing.unitId };

    await clearVacancy(tx, place);
    const tenant = await tx.tenant.create({
      data: {
        ...place,
        createdById: userId,
        name: app.name,
        email: app.email,
        phone: app.phone,
        leaseStart: new Date(`${terms.leaseStart}T00:00:00Z`),
        leaseEnd: new Date(`${terms.leaseEnd}T00:00:00Z`),
        deposit: terms.deposit,
        dueDay: terms.dueDay,
        note: app.pets ? `Pets: ${app.pets}` : null,
      },
    });

    // The listing's rent, from the month the lease starts.
    const history = (await tx.rentChange.findMany({ where: place })).map(serializeRentChange);
    const current = await placeRent(tx, place);
    const startMonth = terms.leaseStart.slice(0, 7);
    const thisMonth = monthKeyOf(new Date());
    const fromMonth = startMonth < thisMonth ? thisMonth : startMonth;
    if (rentForMonth(history, place.propertyId, place.unitId, fromMonth, current) !== listing.rent) {
      await writeRentFrom(tx, place, fromMonth, listing.rent, userId, history.length === 0 ? current : null);
    }

    await tx.rentalApplication.update({
      where: { id: app.id },
      data: { status: "approved", tenantId: tenant.id, decidedById: userId, decidedAt: new Date() },
    });
    await tx.listing.update({ where: { id: listing.id }, data: { open: false, closedAt: listing.closedAt ?? new Date() } });
    return { ok: true as const, tenantId: tenant.id, propertyId: listing.propertyId };
  });
}

/** Listings for these companies, newest first, with what's waiting on each. */
export async function listingsWhere(where: Prisma.ListingWhereInput) {
  const rows = await prisma.listing.findMany({
    where,
    orderBy: [{ open: "desc" }, { createdAt: "desc" }],
    include: { applications: { select: { status: true } } },
  });
  return rows.map((l) => serializeListing(l));
}
