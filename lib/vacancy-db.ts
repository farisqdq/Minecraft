import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** The place a tenant rents: their unit, or the property when it has none. */
type Target = { propertyId: string; unitId: string | null };

/**
 * After a move-out, marks the place vacant from `since` — unless someone
 * else is living there or it was already marked. Returns whether it did, so
 * undoing the move-out can reverse exactly that and nothing more.
 */
export async function markVacantAfterMoveOut(tx: Tx, target: Target & { tenantId: string }, since: Date) {
  const others = await tx.tenant.count({
    where: { propertyId: target.propertyId, unitId: target.unitId, active: true, id: { not: target.tenantId } },
  });
  if (others > 0) return false;
  if (target.unitId) {
    const unit = await tx.unit.findUnique({ where: { id: target.unitId }, select: { vacant: true } });
    if (!unit || unit.vacant) return false;
    await tx.unit.update({ where: { id: target.unitId }, data: { vacant: true, vacantSince: since } });
  } else {
    const property = await tx.property.findUnique({ where: { id: target.propertyId }, select: { vacant: true } });
    if (!property || property.vacant) return false;
    await tx.property.update({ where: { id: target.propertyId }, data: { vacant: true, vacantSince: since } });
  }
  return true;
}

/** A place with a current tenant isn't vacant. */
export async function clearVacancy(tx: Tx, target: Target) {
  if (target.unitId) {
    await tx.unit.updateMany({ where: { id: target.unitId, vacant: true }, data: { vacant: false, vacantSince: null } });
  } else {
    await tx.property.updateMany({
      where: { id: target.propertyId, vacant: true },
      data: { vacant: false, vacantSince: null },
    });
  }
}

/**
 * The vacantSince to store when a place's vacant flag is set by hand: a date
 * the landlord gave, or today when it has just become vacant, or whatever it
 * already was when it stays vacant. Null once it's let.
 */
export function vacantSinceFor(
  vacant: boolean,
  wasVacant: boolean,
  current: Date | null,
  given: unknown
): Date | null | { error: string } {
  if (!vacant) return null;
  if (typeof given === "string" && given) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(given)) return { error: "That vacant-since date isn't valid." };
    const d = new Date(`${given}T00:00:00.000Z`);
    if (isNaN(d.getTime())) return { error: "That vacant-since date isn't valid." };
    return d;
  }
  if (given === "" || given === null) return wasVacant ? null : todayUTC();
  return wasVacant ? current : todayUTC();
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export const sinceDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
