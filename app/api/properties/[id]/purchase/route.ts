import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { parsePurchaseInput } from "@/lib/returns";
import { dateOf, purchaseOf, latestDay } from "@/lib/returns-db";

/**
 * What was paid for a property, when, and the cash that went in (a31).
 * Property details are a member's to keep, like the address and the rent;
 * none of this reaches the ledger or the tax export.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parsePurchaseInput(await req.json().catch(() => null), latestDay());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { purchasePrice, purchasedOn, cashInvested } = parsed.value;
  const property = await prisma.property.update({
    where: { id },
    data: { purchasePrice, purchasedOn: purchasedOn ? dateOf(purchasedOn) : null, cashInvested },
    select: { purchasePrice: true, purchasedOn: true, cashInvested: true },
  });
  return NextResponse.json(purchaseOf(property));
}
