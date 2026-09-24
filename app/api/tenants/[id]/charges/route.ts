import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { statementForTenant } from "@/lib/statements";
import { validAmount } from "@/lib/money";

/**
 * Anything owed that isn't the scheduled rent — a late fee, the lot fee that
 * rides along with rent, a repair they're liable for — or a credit the other
 * way.
 *
 * Direction is a `kind`, never the sign of the amount, so a stray minus can't
 * quietly turn a charge into a refund.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const kind = body?.kind === "credit" ? "credit" : "fee";
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 120) : "";
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  const amount = Math.round((Number(body?.amount) || 0) * 100) / 100;

  if (!label) return NextResponse.json({ error: "What is it for?" }, { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Which month does it belong to?" }, { status: 400 });
  }
  if (!validAmount(amount)) return NextResponse.json({ error: "Enter an amount." }, { status: 400 });

  await prisma.tenantCharge.create({
    data: { tenantId: id, kind, month, label, amount, raisedById: userId },
  });
  return NextResponse.json(await statementForTenant(id), { status: 201 });
}

/**
 * Delete a charge: the money comes off the balance and the row is gone, as
 * if it had never been added. Rent can't be deleted this way — it isn't
 * stored here.
 *
 * This works the same whether a person typed the charge or a standing rule
 * made it. A rule remembers which months it has run for in its own table,
 * not on the charge, so deleting a rule's late fee does not bring it back on
 * the next page load.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const chargeId = new URL(req.url).searchParams.get("charge") ?? "";
  // Scoped to this tenant as well as to the id, so a charge on someone else's
  // books can't be removed by passing its id to a tenant you can reach.
  const removed = await prisma.tenantCharge.deleteMany({ where: { id: chargeId, tenantId: id } });
  if (removed.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(await statementForTenant(id));
}
