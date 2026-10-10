import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireValuation } from "@/lib/access";
import { parseValuationInput } from "@/lib/returns";
import { dateOf, serializeValuation, latestDay } from "@/lib/returns-db";

/** Corrects a valuation — a typo in the figure, the wrong day. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await requireValuation(userId, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseValuationInput(
    {
      value: existing.value,
      asOf: existing.asOf.toISOString().slice(0, 10),
      source: existing.source ?? "",
      note: existing.note ?? "",
      ...(body ?? {}),
    },
    latestDay()
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { value, asOf, source, note } = parsed.value;
  const valuation = await prisma.propertyValuation.update({
    where: { id },
    data: { value, asOf: dateOf(asOf), source: source || null, note: note || null },
  });
  return NextResponse.json(serializeValuation(valuation));
}

/**
 * An opinion of price, not money that moved: nothing else hangs off it, so
 * whoever can record one can take one back.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireValuation(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.propertyValuation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
