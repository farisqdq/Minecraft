import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { statementForTenant } from "@/lib/statements";
import { MAX_AUTO_CHARGE } from "@/lib/charge-rules";
import { currentMonthOf } from "@/lib/statements";

const MONTH = /^\d{4}-\d{2}$/;

/** Rules bill money without anyone pressing a button, so keep the list short. */
const MAX_RULES = 8;
/** A grace period longer than a month would never fire before the next one. */
const MAX_GRACE = 28;

function readBody(body: Record<string, unknown> | null) {
  const kind = body?.kind === "late" ? "late" : "monthly";
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "";
  const percent = body?.percent === true;
  const amount = Math.round((Number(body?.amount) || 0) * 100) / 100;
  const graceDays = Math.min(MAX_GRACE, Math.max(0, Math.round(Number(body?.graceDays) || 0)));
  const startMonth = typeof body?.startMonth === "string" ? body.startMonth.trim() : "";
  const endMonth = typeof body?.endMonth === "string" ? body.endMonth.trim() : "";

  if (!label) return { error: "What is it for?" as const };
  if (!(amount > 0)) return { error: "Enter an amount." as const };
  // A percentage above 100 isn't a fee, it's a typo, and the engine's own cap
  // shouldn't be the only thing standing between a tenant and a huge bill.
  if (percent && amount > 100) return { error: "A percentage can't be over 100." as const };
  if (!percent && amount > MAX_AUTO_CHARGE) {
    return { error: `A rule can't bill more than $${MAX_AUTO_CHARGE} at a time.` as const };
  }
  if (startMonth && !MONTH.test(startMonth)) return { error: "Pick a month to start." as const };
  if (endMonth && !MONTH.test(endMonth)) return { error: "Pick a month to stop." as const };
  if (startMonth && endMonth && endMonth < startMonth) {
    return { error: "It can't stop before it starts." as const };
  }

  return {
    data: {
      kind,
      label,
      amount,
      percent,
      graceDays: kind === "late" ? graceDays : 0,
      startMonth: startMonth || null,
      endMonth: endMonth || null,
      active: body?.active !== false,
    },
  };
}

/**
 * A standing rule: something billed every month alongside rent, or a fee that
 * applies only while rent is still owed.
 *
 * The rule itself bills nothing. Charges appear when the tenant's statement is
 * worked out, as ordinary rows that can be seen and deleted — so there is never
 * a figure on a bill that doesn't have a line behind it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = readBody(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if ((await prisma.tenantChargeRule.count({ where: { tenantId: id } })) >= MAX_RULES) {
    return NextResponse.json(
      { error: `That's already ${MAX_RULES} rules on this tenant. Remove one first.` },
      { status: 400 }
    );
  }

  await prisma.tenantChargeRule.create({
    data: {
      ...parsed.data,
      // A new rule starts this month unless told otherwise. Without this, a
      // lot fee set up today would reach back over every month already on
      // the books and bill them all at once — fourteen months of fees for
      // pressing Add.
      startMonth: parsed.data.startMonth ?? currentMonthOf(),
      tenantId: id,
      createdById: userId,
    },
  });
  return NextResponse.json(await statementForTenant(id), { status: 201 });
}

/** Change a rule, or switch it off without losing the charges it made. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const ruleId = typeof body?.rule === "string" ? body.rule : "";

  // Scoped to this tenant as well as to the id, so a rule on someone else's
  // books can't be reached by passing its id to a tenant you can see.
  const existing = await prisma.tenantChargeRule.findFirst({ where: { id: ruleId, tenantId: id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Switching one off is the common case and needs none of the other fields.
  if (Object.keys(body ?? {}).length === 2 && "active" in (body ?? {})) {
    await prisma.tenantChargeRule.update({
      where: { id: ruleId },
      data: { active: body?.active === true },
    });
    return NextResponse.json(await statementForTenant(id));
  }

  const parsed = readBody(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  await prisma.tenantChargeRule.update({ where: { id: ruleId }, data: parsed.data });
  return NextResponse.json(await statementForTenant(id));
}

/**
 * Remove a rule. The charges it already made stay: they were billed, and a
 * statement that silently loses months of lot fees is worse than one with a
 * rule you have to look up.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ruleId = new URL(req.url).searchParams.get("rule") ?? "";
  const removed = await prisma.tenantChargeRule.deleteMany({ where: { id: ruleId, tenantId: id } });
  if (removed.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(await statementForTenant(id));
}
