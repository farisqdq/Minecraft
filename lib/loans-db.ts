import { prisma } from "@/lib/prisma";
import type { Loan, LoanPayment, Prisma } from "@prisma/client";
import type { LoanTerms } from "@/lib/loans";

export type LoanPaymentDTO = {
  id: string;
  month: string;
  /** YYYY-MM-DD */
  date: string;
  principal: number;
  interest: number;
  escrow: number;
};

export type LoanDTO = LoanTerms & {
  id: string;
  propertyId: string;
  lender: string;
  active: boolean;
  note: string;
  /** Oldest first. */
  payments: LoanPaymentDTO[];
};

export const loanInclude = { payments: { orderBy: { month: "asc" } } } as const satisfies Prisma.LoanInclude;

export function serializePayment(p: LoanPayment): LoanPaymentDTO {
  return {
    id: p.id,
    month: p.month,
    date: p.date.toISOString().slice(0, 10),
    principal: p.principal,
    interest: p.interest,
    escrow: p.escrow,
  };
}

export function serializeLoan(l: Loan & { payments: LoanPayment[] }): LoanDTO {
  return {
    id: l.id,
    propertyId: l.propertyId,
    lender: l.lender,
    balance: l.balance,
    balanceAsOf: l.balanceAsOf,
    rate: l.rate,
    payment: l.payment,
    escrowTax: l.escrowTax,
    escrowInsurance: l.escrowInsurance,
    dueDay: l.dueDay,
    active: l.active,
    note: l.note ?? "",
    payments: l.payments.map(serializePayment),
  };
}

export async function loansWhere(where: Prisma.LoanWhereInput) {
  const rows = await prisma.loan.findMany({ where, include: loanInclude, orderBy: { createdAt: "asc" } });
  return rows.map(serializeLoan);
}

/** A ledger entry in the shape both the dashboard and the property page keep in state. */
export function serializeLedgerEntry(t: {
  id: string;
  propertyId: string;
  unitId: string | null;
  type: string;
  date: Date;
  amount: number;
  detail: string | null;
  note: string | null;
  category: string | null;
  recurringExpenseId: string | null;
  loanPaymentId: string | null;
}) {
  return {
    id: t.id,
    propertyId: t.propertyId,
    unitId: t.unitId,
    type: t.type as "rent" | "expense",
    date: t.date.toISOString().slice(0, 10),
    amount: t.amount,
    detail: t.detail ?? "",
    note: t.note ?? "",
    category: t.category ?? "",
    recurringExpenseId: t.recurringExpenseId,
    loanPaymentId: t.loanPaymentId,
    attachments: [] as never[],
    proofCount: 0,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" → "Mar 2026", for messages written on the server. */
export function shortMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1] ?? "?"} ${y}`;
}
