import { prisma } from "@/lib/prisma";
import { rentForMonth, type RentChangeDTO } from "@/lib/rent";
import {
  buildStatement,
  resolveStartMonth,
  type ChargeInput,
  type Statement,
} from "@/lib/balance";

/**
 * Turning a tenant row into a statement: the database half of lib/balance.ts.
 */

export type StatementResult = {
  statement: Statement;
  /**
   * Set when the figures can't be trusted for this tenant, with the reason.
   * Better an honest refusal than a confident wrong number about money.
   */
  problem: string;
  startMonth: string;
  openingBalance: number;
  /** Whether the landlord pinned the start, or it was inferred. */
  startPinned: boolean;
  /**
   * Whether these books rest on anything: a payment on file, a start the
   * landlord pinned, an opening balance, a charge. When they don't, the
   * statement is just "this month's rent, unpaid" — true enough for the
   * landlord, who knows what he has and hasn't entered, but not something to
   * put in front of a tenant as their account.
   */
  grounded: boolean;
  charges: { id: string; month: string; kind: string; label: string; amount: number }[];
};

export const monthOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export const currentMonthOf = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

export async function statementForTenant(tenantId: string, now = new Date()): Promise<StatementResult | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      property: { select: { id: true, monthlyRent: true, vacant: true } },
      unit: { select: { id: true, monthlyRent: true, vacant: true } },
      charges: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!tenant) return null;

  const currentMonth = currentMonthOf(now);

  // Rent lands against a property and optionally a unit, not against a
  // person. If two tenants share exactly the same target, there is no way to
  // say whose money arrived, so say that rather than attribute it twice.
  const sharing = await prisma.tenant.count({
    where: { propertyId: tenant.propertyId, unitId: tenant.unitId, active: true },
  });

  const [payments, rentChanges] = await Promise.all([
    prisma.transaction.findMany({
      where: { propertyId: tenant.propertyId, unitId: tenant.unitId, type: "rent" },
      select: { date: true, amount: true },
      orderBy: { date: "asc" },
    }),
    prisma.rentChange.findMany({
      where: { propertyId: tenant.propertyId, unitId: tenant.unitId },
      orderBy: { effectiveFrom: "asc" },
    }),
  ]);

  const changeDTOs: RentChangeDTO[] = rentChanges.map((c) => ({
    id: c.id,
    propertyId: c.propertyId,
    unitId: c.unitId,
    effectiveFrom: monthOf(c.effectiveFrom),
    amount: c.amount,
  }));

  const currentRent = tenant.unit ? tenant.unit.monthlyRent : tenant.property.monthlyRent;
  const vacant = tenant.unit ? tenant.unit.vacant : tenant.property.vacant;

  const startMonth = resolveStartMonth({
    explicit: tenant.balanceFrom,
    firstPaymentMonth: payments.length ? monthOf(payments[0].date) : null,
    leaseStartMonth: tenant.leaseStart ? monthOf(tenant.leaseStart) : null,
    currentMonth,
  });

  // A tenant who has moved out stops being charged at the end of their lease,
  // or at their last payment if no end date was ever recorded.
  const lastRentMonth = tenant.active
    ? null
    : tenant.leaseEnd
      ? monthOf(tenant.leaseEnd)
      : payments.length
        ? monthOf(payments[payments.length - 1].date)
        : startMonth;

  const charges: ChargeInput[] = tenant.charges.map((c) => ({
    month: c.month,
    kind: c.kind === "credit" ? "credit" : "fee",
    amount: c.amount,
    label: c.label,
  }));

  const statement = buildStatement({
    startMonth,
    currentMonth,
    openingBalance: tenant.openingBalance,
    lastRentMonth,
    rentFor: (month) =>
      vacant ? 0 : rentForMonth(changeDTOs, tenant.propertyId, tenant.unitId, month, currentRent),
    charges,
    payments: payments.map((p) => ({ month: monthOf(p.date), amount: p.amount })),
  });

  return {
    statement,
    problem:
      sharing > 1
        ? "Two tenants share this property without units, so there's no way to tell whose rent arrived. Give each one a unit to split the books."
        : "",
    startMonth,
    openingBalance: tenant.openingBalance,
    startPinned: Boolean(tenant.balanceFrom),
    grounded:
      payments.length > 0 ||
      Boolean(tenant.balanceFrom) ||
      Math.abs(tenant.openingBalance) > 0.005 ||
      tenant.charges.length > 0,
    charges: tenant.charges.map((c) => ({
      id: c.id,
      month: c.month,
      kind: c.kind,
      label: c.label,
      amount: c.amount,
    })),
  };
}

/** Just the number, for a list of cards. One query per tenant is fine at this size. */
export async function balancesForTenants(tenantIds: string[], now = new Date()) {
  const out: Record<string, { balance: number; behindSince: string; problem: string }> = {};
  for (const id of tenantIds) {
    const result = await statementForTenant(id, now);
    if (!result) continue;
    out[id] = {
      balance: result.statement.balance,
      behindSince: result.statement.behindSince,
      problem: result.problem,
    };
  }
  return out;
}
