import type { MoveOut, MoveOutDeduction } from "@prisma/client";

export type MoveOutDTO = {
  id: string;
  tenantId: string;
  /** YYYY-MM-DD */
  movedOutOn: string;
  lastRentMonth: string;
  deposit: number;
  refund: number;
  returnBy: string | null;
  returnedOn: string | null;
  returnNote: string;
  forwardingAddress: string;
  deductions: { kind: "rent" | "charge"; label: string; amount: number }[];
};

export const moveOutInclude = { deductions: { orderBy: { id: "asc" } } } as const;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function serializeMoveOut(m: MoveOut & { deductions: MoveOutDeduction[] }): MoveOutDTO {
  return {
    id: m.id,
    tenantId: m.tenantId,
    movedOutOn: m.movedOutOn.toISOString().slice(0, 10),
    lastRentMonth: m.lastRentMonth,
    deposit: m.deposit,
    refund: m.refund,
    returnBy: day(m.returnBy),
    returnedOn: day(m.returnedOn),
    returnNote: m.returnNote ?? "",
    forwardingAddress: m.forwardingAddress ?? "",
    // Rent first, as it reads on a statement: what they owed, then what they broke.
    deductions: m.deductions
      .map((d) => ({ kind: (d.kind === "rent" ? "rent" : "charge") as "rent" | "charge", label: d.label, amount: d.amount }))
      .sort((a, b) => Number(b.kind === "rent") - Number(a.kind === "rent")),
  };
}
