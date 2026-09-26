import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireLoan } from "@/lib/access";
import { parseLoanInput } from "@/lib/loans";
import { loanInclude, serializeLoan } from "@/lib/loans-db";

/**
 * Changes a loan's terms, or closes and reopens it.
 *
 * The rate, the payment and the escrow can change at any time — an
 * adjustable rate resets, escrow is re-figured every year — and only future
 * payments are worked out from them; recorded payments keep the split they
 * were made with. The starting balance can't move once payments hang off it,
 * because every balance since is that figure less what's been paid.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const loan = await requireLoan(userId, id);
  if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Closing or reopening on its own.
  if (Object.keys(body).length === 1 && "active" in body) {
    const updated = await prisma.loan.update({
      where: { id },
      data: { active: Boolean(body.active) },
      include: loanInclude,
    });
    return NextResponse.json(serializeLoan(updated));
  }

  const parsed = parseLoanInput({
    lender: loan.lender,
    balance: loan.balance,
    balanceAsOf: loan.balanceAsOf,
    rate: loan.rate,
    payment: loan.payment,
    escrowTax: loan.escrowTax,
    escrowInsurance: loan.escrowInsurance,
    dueDay: loan.dueDay,
    note: loan.note ?? "",
    ...body,
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const payments = await prisma.loanPayment.count({ where: { loanId: id } });
  const startMoved =
    Math.round(parsed.value.balance * 100) !== Math.round(loan.balance * 100) ||
    parsed.value.balanceAsOf !== loan.balanceAsOf;
  if (payments > 0 && startMoved) {
    return NextResponse.json(
      {
        error:
          "The starting balance is fixed once payments are recorded against it — every balance since is worked out from it. Undo the payments first, or close this loan and add it again.",
      },
      { status: 409 }
    );
  }

  const updated = await prisma.loan.update({
    where: { id },
    data: {
      ...parsed.value,
      ...("active" in body ? { active: Boolean(body.active) } : {}),
    },
    include: loanInclude,
  });
  return NextResponse.json(serializeLoan(updated));
}

/**
 * Removes the loan record and its payment history. The interest and escrow
 * already in the ledger stay: that money was really paid, and a tax year's
 * figures must not change because a loan was tidied away.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireLoan(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await requireLoan(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner of this LLC can remove a loan." }, { status: 403 });
  }

  await prisma.loan.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
