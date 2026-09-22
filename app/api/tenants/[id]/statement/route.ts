import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { statementForTenant } from "@/lib/statements";

/** Month by month: charged, paid, and what's left owing. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await statementForTenant(id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result);
}

/**
 * Where the books start for this tenant, and what they owed on that day.
 *
 * This is the escape hatch for the one thing the app refuses to guess: a
 * lease that began long before the ledger did. Without it a landlord would
 * have to accept whatever the app inferred; with it they can say "start in
 * January, they were $1,750 behind then" and have every month since add up.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data: { balanceFrom?: string | null; openingBalance?: number } = {};

  if ("balanceFrom" in (body ?? {})) {
    const raw = typeof body.balanceFrom === "string" ? body.balanceFrom.trim() : "";
    if (raw && !/^\d{4}-\d{2}$/.test(raw)) {
      return NextResponse.json({ error: "Pick a month." }, { status: 400 });
    }
    // Blank hands the decision back to the app, which infers it from the
    // first payment on file.
    data.balanceFrom = raw || null;
  }
  if ("openingBalance" in (body ?? {})) {
    const amount = Number(body.openingBalance);
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: "That isn't an amount." }, { status: 400 });
    }
    // Negative is legitimate: a tenant can start in credit.
    data.openingBalance = Math.round(amount * 100) / 100;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  await prisma.tenant.update({ where: { id }, data });
  return NextResponse.json(await statementForTenant(id));
}
