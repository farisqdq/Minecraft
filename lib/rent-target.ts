/**
 * Which rent target a "whole property" entry belongs to.
 *
 * Rent, tenants and rent history hang off a property and, optionally, one of
 * its units. On a property with several units, an entry on the whole
 * property belongs to none of them: there's no telling which suite a
 * payment was for, so it stays unattributed.
 *
 * A property with exactly one unit is different. The unit and the property
 * are the same place — "1786 Bryan Station #A" with its one unit "#A" — and
 * landlords log rent against either without thinking about it. Treating
 * them as two places splits one tenancy in half: the rent is set on #A, the
 * tenant and their payments sit on the whole property, and her statement
 * reads $0 rent while the card reads $4,570 short. So on a single-unit
 * property, the whole property *is* that unit: a tenant on the property is
 * the unit's tenant, and rent logged against the property is the unit's
 * rent. The unit's own rent figure (and its history and vacancy) is what's
 * expected, as the dashboard card already shows it.
 *
 * Pure, relative imports only, so the dashboard card and the statement use
 * one rule.
 */

export type UnitRef = { id: string };

/** The one unit of a single-unit property, or null (no units, or several). */
export function soleUnitId(units: readonly UnitRef[]): string | null {
  return units.length === 1 ? units[0].id : null;
}

/**
 * The unit a tenant, payment or rent change at `unitId` really belongs to:
 * itself, except that the whole property (null) on a single-unit property is
 * that unit.
 */
export function rentTargetOf(unitId: string | null, units: readonly UnitRef[]): string | null {
  return unitId ?? soleUnitId(units);
}

/**
 * The stored unitIds whose entries count toward the target at `unitId`:
 * on a single-unit property the unit and the whole property together;
 * anywhere else, exactly the one given.
 */
export function unitIdsCountingToward(unitId: string | null, units: readonly UnitRef[]): (string | null)[] {
  const target = rentTargetOf(unitId, units);
  return target !== null && target === soleUnitId(units) ? [target, null] : [target];
}

/** Whether an entry stored at `entryUnitId` counts toward the target at `targetUnitId`. */
export function countsToward(
  entryUnitId: string | null,
  targetUnitId: string | null,
  units: readonly UnitRef[]
): boolean {
  return rentTargetOf(entryUnitId, units) === rentTargetOf(targetUnitId, units);
}
