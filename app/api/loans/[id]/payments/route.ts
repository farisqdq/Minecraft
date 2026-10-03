import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireLoan } from "@/lib/access";
import { parsePaymentInput } from "@/lib/loans";
import { recordLoanPayment, serializeLedgerEntry, serializePayment, shortMonth } from "@/lib/loans-db";

/**
 * Records one month's mortgage payment.
 *
 * Interest goes into the ledger as Mortgage Interest and each escrow part
 * under its own category — Property Tax, Insurance — because those are
 * separate lines on Schedule E. Principal is written only to the payment:
 * it reduces what's owed and is not an expense.
 *
 * Sending only a month takes the suggested split, which is what the
 * dashboard's "Log it" does; the property page sends the lender's figures.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const loan = await requireLoan(userId, id);
  if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.loanPayment.findMany({ where: { loanId: id } });
  const parsed = parsePaymentInput(await req.json().catch(() => null), loan, existing);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const p = parsed.value;

  if (existing.some((e) => e.month === p.month)) {
    return NextResponse.json(
      { error: `The ${shortMonth(p.month)} payment on ${loan.lender} is already recorded.` },
      { status: 409 }
    );
  }

  try {
    const result = await prisma.$transaction((tx) => recordLoanPayment(tx, loan, p, userId));

    return NextResponse.json(
      {
        payment: serializePayment(result.payment),
        transactions: result.entries.map(serializeLedgerEntry),
      },
      { status: 201 }
    );
  } catch (e) {
    // Two taps, or two phones, racing past the check above: the unique
    // index on (loan, month) is what actually stops a double payment.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { error: `The ${shortMonth(p.month)} payment on ${loan.lender} is already recorded.` },
        { status: 409 }
      );
    }
    throw e;
  }
}
