import type { Prisma } from "@prisma/client";

export type RentChangeDTO = {
  id: string;
  propertyId: string;
  unitId: string | null;
  /** The month the amount took effect, as YYYY-MM. */
  effectiveFrom: string;
  amount: number;
};

/**
 * What a place was renting for in a given month.
 *
 * Rent goes up. Without a history, every month already on the books gets
 * re-judged against today's figure — raise the rent in January and the whole
 * previous year reads as short, for tenants who paid exactly what they owed.
 *
 * `current` is the fallback for months before the earliest recorded change,
 * which is also the answer for every property that has never had one.
 */
export function rentForMonth(
  changes: RentChangeDTO[],
  propertyId: string,
  unitId: string | null,
  month: string,
  current: number
) {
  let best: RentChangeDTO | null = null;
  for (const c of changes) {
    if (c.propertyId !== propertyId) continue;
    if ((c.unitId ?? null) !== unitId) continue;
    if (c.effectiveFrom > month) continue;
    // Later changes win; ties can't happen because one row is written per
    // month, but taking the later one keeps it deterministic if they do.
    if (!best || c.effectiveFrom >= best.effectiveFrom) best = c;
  }
  return best ? best.amount : current;
}

/** Every change for one place, newest first — for showing the history. */
export function historyFor(changes: RentChangeDTO[], propertyId: string, unitId: string | null) {
  return changes
    .filter((c) => c.propertyId === propertyId && (c.unitId ?? null) === unitId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

/** The first of a YYYY-MM, as the UTC instant the column stores. */
export function monthStart(month: string) {
  return new Date(`${month}-01T00:00:00.000Z`);
}

export function monthKeyOf(date: Date) {
  return date.toISOString().slice(0, 7);
}

/**
 * Writes a rent change when the figure actually moves.
 *
 * The first change for a place also backfills what it used to rent for,
 * effective from before any transaction could exist — otherwise the months
 * already on the books would fall through to the *new* current figure, which
 * is the exact thing this table exists to prevent.
 */
export async function recordRentChange(
  tx: Prisma.TransactionClient,
  {
    propertyId,
    unitId,
    from,
    to,
    month,
    userId,
  }: {
    propertyId: string;
    unitId: string | null;
    from: number;
    to: number;
    month: string;
    userId: string | null;
  }
) {
  if (from === to) return;

  const existing = await tx.rentChange.findFirst({ where: { propertyId, unitId } });
  if (!existing) {
    await tx.rentChange.create({
      data: {
        propertyId,
        unitId,
        // Earlier than any record this app can hold, so it covers all history.
        effectiveFrom: new Date("1970-01-01T00:00:00.000Z"),
        amount: from,
        createdById: userId,
      },
    });
  }

  await tx.rentChange.create({
    data: { propertyId, unitId, effectiveFrom: monthStart(month), amount: to, createdById: userId },
  });
}
