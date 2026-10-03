/**
 * Lease renewals, in the database: renewing, undoing, and moving a place's
 * current rent when a raise written ahead of time comes due.
 */

import type { LeaseRenewal, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { monthKeyOf, monthStart, rentForMonth, serializeRentChange } from "./rent";
import { dueRentFlips, renewalMessage, type RenewalInput } from "./renewal";

export type RenewalDTO = {
  id: string;
  tenantId: string;
  previousEnd: string;
  newEnd: string;
  previousRent: number;
  newRent: number;
  rentFrom: string;
  note: string;
  sentAt: string;
  createdAt: string;
  /** Whether undo is still possible: the new rent hasn't started. */
  undoable: boolean;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export function serializeRenewal(r: LeaseRenewal, thisMonth = monthKeyOf(new Date())): RenewalDTO {
  return {
    id: r.id,
    tenantId: r.tenantId,
    previousEnd: day(r.previousEnd),
    newEnd: day(r.newEnd),
    previousRent: r.previousRent,
    newRent: r.newRent,
    rentFrom: r.rentFrom,
    note: r.note ?? "",
    sentAt: r.sentAt ? r.sentAt.toISOString() : "",
    createdAt: r.createdAt.toISOString(),
    undoable: r.newRent === r.previousRent || !r.rentChangeId || r.rentFrom > thisMonth,
  };
}

type Place = { propertyId: string; unitId: string | null };

async function placeRent(tx: Prisma.TransactionClient, place: Place) {
  if (place.unitId) {
    const unit = await tx.unit.findUnique({ where: { id: place.unitId }, select: { monthlyRent: true } });
    return unit?.monthlyRent ?? 0;
  }
  const property = await tx.property.findUnique({ where: { id: place.propertyId }, select: { monthlyRent: true } });
  return property?.monthlyRent ?? 0;
}

async function setPlaceRent(tx: Prisma.TransactionClient, place: Place, amount: number) {
  if (place.unitId) await tx.unit.update({ where: { id: place.unitId }, data: { monthlyRent: amount } });
  else await tx.property.update({ where: { id: place.propertyId }, data: { monthlyRent: amount } });
}

/**
 * Renews a tenant's lease: moves its end, writes the new rent into the
 * history from the month it starts, and records the renewal.
 *
 * A raise for a later month is written now and marked scheduled — every
 * month is read from the history, so it is charged from its month however
 * long it is before anyone opens the app. A raise from this month is in
 * force at once, as an edit to the rent would be.
 *
 * Renewing again replaces any raise scheduled from the same month or later
 * that hasn't started: the newest agreement is the one that stands.
 */
export async function renewLease(
  userId: string,
  tenant: { id: string; propertyId: string; unitId: string | null; leaseEnd: Date | null },
  input: RenewalInput
) {
  const place = { propertyId: tenant.propertyId, unitId: tenant.unitId };
  const thisMonth = monthKeyOf(new Date());
  return prisma.$transaction(async (tx) => {
    const current = await placeRent(tx, place);
    await tx.rentChange.deleteMany({
      where: {
        ...place,
        scheduledAt: { not: null },
        appliedAt: null,
        effectiveFrom: { gte: monthStart(input.rentFrom) },
      },
    });
    const history = (await tx.rentChange.findMany({ where: place })).map(serializeRentChange);
    const previousRent = rentForMonth(history, place.propertyId, place.unitId, thisMonth, current);
    const atStart = rentForMonth(history, place.propertyId, place.unitId, input.rentFrom, current);

    let rentChangeId: string | null = null;
    if (input.newRent !== atStart) {
      if (history.length === 0) {
        // The same backfill an edit to the rent writes: the months already
        // on the books stay at what they were.
        await tx.rentChange.create({
          data: { ...place, effectiveFrom: new Date("1970-01-01T00:00:00.000Z"), amount: current, createdById: userId },
        });
      }
      const scheduled = input.rentFrom > thisMonth;
      const existing = await tx.rentChange.findFirst({ where: { ...place, effectiveFrom: monthStart(input.rentFrom) } });
      const row = existing
        ? await tx.rentChange.update({
            where: { id: existing.id },
            data: { amount: input.newRent, scheduledAt: scheduled ? new Date() : existing.scheduledAt, appliedAt: scheduled ? null : new Date() },
          })
        : await tx.rentChange.create({
            data: {
              ...place,
              effectiveFrom: monthStart(input.rentFrom),
              amount: input.newRent,
              createdById: userId,
              scheduledAt: scheduled ? new Date() : null,
            },
          });
      rentChangeId = row.id;
      if (!scheduled) await setPlaceRent(tx, place, input.newRent);
    }

    await tx.tenant.update({ where: { id: tenant.id }, data: { leaseEnd: new Date(`${input.newEnd}T00:00:00Z`) } });
    const renewal = await tx.leaseRenewal.create({
      data: {
        tenantId: tenant.id,
        previousEnd: tenant.leaseEnd,
        newEnd: new Date(`${input.newEnd}T00:00:00Z`),
        previousRent,
        newRent: input.newRent,
        rentFrom: input.rentFrom,
        rentChangeId,
        note: input.note || null,
        createdById: userId,
      },
    });
    const rentChanges = (
      await tx.rentChange.findMany({ where: place, orderBy: { effectiveFrom: "asc" } })
    ).map(serializeRentChange);
    return { renewal: serializeRenewal(renewal, thisMonth), rentChanges, monthlyRent: await placeRent(tx, place) };
  });
}

/**
 * Takes a renewal back: the lease end it had, and the scheduled raise it
 * wrote. Only the latest renewal, and only before its rent has started —
 * once tenants have been charged the new figure, putting it back is an
 * edit to the rent, made on purpose from the property page.
 */
export async function undoRenewal(renewalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const thisMonth = monthKeyOf(new Date());
  return prisma.$transaction(async (tx) => {
    const renewal = await tx.leaseRenewal.findUnique({ where: { id: renewalId }, include: { tenant: true, rentChange: true } });
    if (!renewal) return { ok: false as const, error: "That renewal is gone." };
    const latest = await tx.leaseRenewal.findFirst({ where: { tenantId: renewal.tenantId }, orderBy: { createdAt: "desc" } });
    if (latest?.id !== renewal.id) return { ok: false as const, error: "Only the latest renewal can be undone." };
    if (renewal.rentChange && monthKeyOf(renewal.rentChange.effectiveFrom) <= thisMonth) {
      return {
        ok: false as const,
        error: "The new rent has already started. To change it, edit the rent from the property page.",
      };
    }
    if (renewal.rentChange) await tx.rentChange.delete({ where: { id: renewal.rentChange.id } });
    await tx.tenant.update({ where: { id: renewal.tenantId }, data: { leaseEnd: renewal.previousEnd } });
    await tx.leaseRenewal.delete({ where: { id: renewal.id } });

    // Renewing again replaced the earlier renewal's scheduled raise; undoing
    // the later one puts that raise back, so the books are as they were.
    const prior = await tx.leaseRenewal.findFirst({ where: { tenantId: renewal.tenantId }, orderBy: { createdAt: "desc" } });
    if (prior && !prior.rentChangeId && prior.newRent !== prior.previousRent && prior.rentFrom > thisMonth) {
      const place = { propertyId: renewal.tenant.propertyId, unitId: renewal.tenant.unitId };
      const taken = await tx.rentChange.findFirst({ where: { ...place, effectiveFrom: monthStart(prior.rentFrom) } });
      if (!taken) {
        const row = await tx.rentChange.create({
          data: { ...place, effectiveFrom: monthStart(prior.rentFrom), amount: prior.newRent, scheduledAt: new Date(), createdById: prior.createdById },
        });
        await tx.leaseRenewal.update({ where: { id: prior.id }, data: { rentChangeId: row.id } });
      }
    }
    return { ok: true as const };
  });
}

/**
 * Moves the current rent of any place whose scheduled raise has come due.
 * Cheap when nothing is due — one indexed query — so pages that show
 * today's rent call it before reading. Safe to run twice at once: each due
 * row is claimed before the rent is moved.
 */
export async function applyDueRentChanges(scope: Prisma.RentChangeWhereInput = {}): Promise<number> {
  const thisMonth = monthKeyOf(new Date());
  const due = await prisma.rentChange.findMany({
    where: { ...scope, scheduledAt: { not: null }, appliedAt: null, effectiveFrom: { lte: monthStart(thisMonth) } },
  });
  if (due.length === 0) return 0;

  const places = new Map<string, Place>();
  for (const c of due) places.set(`${c.propertyId}|${c.unitId ?? ""}`, { propertyId: c.propertyId, unitId: c.unitId });
  const latestInForce = new Map<string, { id: string }>();
  for (const [key, place] of places) {
    const row = await prisma.rentChange.findFirst({
      where: { ...place, effectiveFrom: { lte: monthStart(thisMonth) } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (row) latestInForce.set(key, row);
  }

  let moved = 0;
  const flips = dueRentFlips(
    due.map((c) => ({ id: c.id, propertyId: c.propertyId, unitId: c.unitId, effectiveFrom: monthKeyOf(c.effectiveFrom), amount: c.amount })),
    latestInForce
  );
  for (const flip of flips) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.rentChange.updateMany({ where: { id: { in: flip.ids }, appliedAt: null }, data: { appliedAt: new Date() } });
      if (claimed.count === 0 || flip.amount === null) return;
      await setPlaceRent(tx, flip, flip.amount);
      moved += 1;
    });
  }
  return moved;
}

/** Everything the renewal letter and message say, read fresh. */
export async function renewalLetter(renewalId: string) {
  const renewal = await prisma.leaseRenewal.findUnique({
    where: { id: renewalId },
    include: { tenant: { include: { property: { include: { company: true } }, unit: { select: { name: true } } } } },
  });
  if (!renewal) return null;
  const t = renewal.tenant;
  const place = [t.property.name, t.unit?.name].filter(Boolean).join(", ");
  const dto = serializeRenewal(renewal);
  const text = renewalMessage({
    tenantName: t.name,
    place,
    previousEnd: dto.previousEnd,
    newEnd: dto.newEnd,
    previousRent: renewal.previousRent,
    newRent: renewal.newRent,
    rentFrom: renewal.rentFrom,
    dueDay: t.dueDay,
    companyName: t.property.company.name,
    note: renewal.note ?? "",
  });
  return { renewal: dto, tenant: t, company: t.property.company, place, text };
}
