import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { normalizeCategory as normalizeExpenseCategory } from "@/lib/categories";
import { text } from "@/lib/maintenance";
import { addUpdate, requestForUser, requestInclude, serializeRequest } from "@/lib/requests";

/**
 * Book a finished repair into the ledger without retyping it.
 *
 * The request already knows the property, the unit and what was wrong, so the
 * only thing missing is what it cost. The transaction id is written back onto
 * the request, which is what stops the same repair being booked twice.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await requestForUser(me.id, id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (request.transactionId) {
    return NextResponse.json({ error: "This repair is already on the books." }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const amount = Number(body?.amount);
  const date = typeof body?.date === "string" ? new Date(body.date) : null;
  const category = normalizeExpenseCategory(body?.category);
  const detail = text(body?.detail, 200) || request.title;

  if (!(amount > 0)) return NextResponse.json({ error: "Enter what it cost." }, { status: 400 });
  if (!date || isNaN(date.getTime())) {
    return NextResponse.json({ error: "Pick a date." }, { status: 400 });
  }
  if (!category) return NextResponse.json({ error: "Pick a category." }, { status: 400 });

  const transaction = await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        propertyId: request.propertyId,
        unitId: request.unitId,
        createdById: me.id,
        type: "expense",
        date,
        amount,
        detail,
        note: `Repair reported ${request.createdAt.toISOString().slice(0, 10)}`,
        category,
      },
    });
    await tx.maintenanceRequest.update({
      where: { id },
      data: {
        transactionId: created.id,
        status: "done",
        resolvedAt: request.resolvedAt ?? new Date(),
        seenAt: request.seenAt ?? new Date(),
      },
    });
    return created;
  });

  // The tenant sees that it was fixed, never what it cost.
  if (request.status !== "done") {
    await addUpdate({
      requestId: id,
      authorName: me.name || me.email || "Your landlord",
      authorUserId: me.id,
      body: "Done",
      statusTo: "done",
    });
  }

  const fresh = await prisma.maintenanceRequest.findUnique({ where: { id }, include: requestInclude });
  return NextResponse.json({ request: serializeRequest(fresh!), transactionId: transaction.id });
}
