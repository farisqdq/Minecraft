import type { Trip } from "@prisma/client";

export type TripDTO = { id: string; propertyId: string; date: string; miles: number; purpose: string; note: string };

export function serializeTrip(t: Trip): TripDTO {
  return {
    id: t.id,
    propertyId: t.propertyId,
    date: t.date.toISOString().slice(0, 10),
    miles: t.miles,
    purpose: t.purpose,
    note: t.note ?? "",
  };
}

/** YYYY-MM-DD to the midnight-UTC instant it's stored as. */
export const tripDate = (day: string) => new Date(`${day}T00:00:00Z`);
