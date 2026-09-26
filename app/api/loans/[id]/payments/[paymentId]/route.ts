import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireLoan } from "@/lib/access";

/**
 * Undoes a recorded payment: the payment and every ledger entry it wrote go
 * together, so the balance and the books can't disagree about whether it
 * happened. Returns the ids of the entries removed so a page can drop them
 * from what it's showing without a reload.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, paymentId } = await params;
  if (!(await requireLoan(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const payment = await prisma.loanPayment.findUnique({
    where: { id: paymentId },
    include: { transactions: { select: { id: true } } },
  });
  if (!payment || payment.loanId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const transactionIds = payment.transactions.map((t) => t.id);
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { loanPaymentId: paymentId } }),
    prisma.loanPayment.delete({ where: { id: paymentId } }),
  ]);
  return NextResponse.json({ ok: true, transactionIds });
}
