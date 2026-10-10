import type { Prisma, PropertyValuation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Purchase, ReturnsEntry, ReturnsLoan, Valuation } from "@/lib/returns";

/**
 * The latest day a purchase or valuation may carry. The server runs on UTC,
 * and someone east of it is already on tomorrow; a day's grace keeps "today"
 * on their phone from being refused as the future.
 */
export function latestDay(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

/** A day stored as midnight UTC, back to YYYY-MM-DD. */
export const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** YYYY-MM-DD to the midnight-UTC instant it's stored as. */
export const dateOf = (day: string): Date => new Date(`${day}T00:00:00Z`);

export function serializeValuation(v: PropertyValuation): Valuation {
  return { id: v.id, value: v.value, asOf: dayOf(v.asOf) as string, source: v.source ?? "", note: v.note ?? "" };
}

export function purchaseOf(p: { purchasePrice: number | null; purchasedOn: Date | null; cashInvested: number | null }): Purchase {
  return { purchasePrice: p.purchasePrice, purchasedOn: dayOf(p.purchasedOn), cashInvested: p.cashInvested };
}

export type ReturnsData = Purchase & {
  valuations: Valuation[];
  entries: ReturnsEntry[];
  loans: ReturnsLoan[];
};

/**
 * Everything lib/returns needs for each property matching `where`, keyed by
 * property id. Only the columns the arithmetic reads: on a portfolio with
 * years of books this is the whole ledger, so it fetches no attachments,
 * notes or descriptions.
 */
export async function returnsDataFor(where: Prisma.PropertyWhereInput): Promise<Map<string, ReturnsData>> {
  const properties = await prisma.property.findMany({
    where,
    select: {
      id: true,
      purchasePrice: true,
      purchasedOn: true,
      cashInvested: true,
      valuations: { orderBy: [{ asOf: "desc" }, { createdAt: "desc" }] },
      loans: {
        select: { balance: true, active: true, payments: { select: { month: true, date: true, principal: true } } },
      },
    },
  });
  const ids = properties.map((p) => p.id);
  const entries = await prisma.transaction.findMany({
    where: { propertyId: { in: ids } },
    select: { propertyId: true, type: true, date: true, amount: true, category: true, appliesTo: true, spreadMonths: true },
  });
  const byProperty = new Map<string, ReturnsEntry[]>(ids.map((id) => [id, []]));
  for (const e of entries) {
    byProperty.get(e.propertyId)?.push({
      type: e.type,
      date: e.date.toISOString().slice(0, 10),
      amount: e.amount,
      category: e.category,
      appliesTo: e.appliesTo,
      spreadMonths: e.spreadMonths,
    });
  }
  return new Map(
    properties.map((p) => [
      p.id,
      {
        ...purchaseOf(p),
        valuations: p.valuations.map(serializeValuation),
        entries: byProperty.get(p.id) ?? [],
        loans: p.loans.map((l) => ({
          balance: l.balance,
          active: l.active,
          payments: l.payments.map((x) => ({ month: x.month, date: x.date.toISOString().slice(0, 10), principal: x.principal })),
        })),
      },
    ])
  );
}
