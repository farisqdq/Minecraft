import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { parseLoanInput } from "@/lib/loans";
import { loanInclude, serializeLoan } from "@/lib/loans-db";

/** Adds a mortgage to a property, from the figures on its latest statement. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = parseLoanInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const loan = await prisma.loan.create({
    data: { ...parsed.value, propertyId: id, createdById: userId },
    include: loanInclude,
  });
  return NextResponse.json(serializeLoan(loan), { status: 201 });
}
