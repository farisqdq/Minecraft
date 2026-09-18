import type { Tenant } from "@prisma/client";

export type TenantDTO = {
  id: string;
  propertyId: string;
  unitId: string | null;
  name: string;
  email: string;
  phone: string;
  leaseStart: string;
  leaseEnd: string;
  deposit: number;
  dueDay: number;
  active: boolean;
  note: string;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Dates go out as plain YYYY-MM-DD, matching how the client stores them. */
export function serializeTenant(t: Tenant): TenantDTO {
  return {
    id: t.id,
    propertyId: t.propertyId,
    unitId: t.unitId,
    name: t.name,
    email: t.email ?? "",
    phone: t.phone ?? "",
    leaseStart: day(t.leaseStart),
    leaseEnd: day(t.leaseEnd),
    deposit: t.deposit,
    dueDay: t.dueDay,
    active: t.active,
    note: t.note ?? "",
  };
}

/** Parses a YYYY-MM-DD form value into a UTC date, or null when it's blank. */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

export function clampDueDay(value: unknown) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1;
}

/** Trimmed text, or null so the column stays empty rather than holding "". */
export function text(value: unknown, max: number) {
  const s = typeof value === "string" ? value.trim().slice(0, max) : "";
  return s || null;
}
