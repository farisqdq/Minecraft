import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { statementForTenant, currentMonthOf } from "@/lib/statements";
import { parseMoveOutInput, settle, suggestRentDeduction } from "@/lib/move-out";
import { isoDay } from "@/lib/lease";
import { moveOutInclude, serializeMoveOut } from "@/lib/move-outs-db";
import { serializeLedgerEntry } from "@/lib/loans-db";
import { serializeTenant } from "@/lib/tenants";
import { clearVacancy, markVacantAfterMoveOut } from "@/lib/vacancy-db";
import { vacancyStart } from "@/lib/vacancy";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Midnight UTC on the 1st of the month after `month`. */
function firstDayAfter(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
}

/** YYYY-MM-DD of the last day of `month`. */
function lastDayOf(month: string) {
  return new Date(firstDayAfter(month).getTime() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * What they'd owe if rent stopped after `through`, and the deposit held —
 * the two numbers the move-out form is built around. Worked out by the same
 * statement engine as their card, so the form and the card can't disagree.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tenant = await requireTenant(userId, id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const through = new URL(req.url).searchParams.get("through") ?? "";
  if (!MONTH_RE.test(through)) return NextResponse.json({ error: "Missing month." }, { status: 400 });

  const result = await statementForTenant(id, new Date(), { lastRentMonth: through });
  const owed = Math.max(0, result?.statement.balance ?? 0);
  // Rent is booked to a place, not a person, so money that arrived after the
  // last rent month isn't counted toward what they owe — it might be the next
  // tenant's. If it was theirs, applying the deposit to "unpaid" rent would
  // collect it twice, so the form says what came in.
  const later = await prisma.transaction.aggregate({
    where: {
      propertyId: tenant.propertyId,
      unitId: tenant.unitId,
      type: "rent",
      moveOutId: null,
      date: { gte: firstDayAfter(through) },
    },
    _sum: { amount: true },
  });
  return NextResponse.json({
    deposit: tenant.deposit,
    owed,
    suggestedRent: suggestRentDeduction(tenant.deposit, owed),
    problem: result?.problem ?? "",
    receivedAfter: Math.round((later._sum.amount ?? 0) * 100) / 100,
  });
}

/**
 * Records a move-out: rent stops, the deposit is settled, and whatever is
 * kept goes into the ledger as rental income. All in one database
 * transaction — half a move-out is worse than none.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tenant = await requireTenant(userId, id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!tenant.active) {
    return NextResponse.json({ error: `${tenant.name} is already a past tenant.` }, { status: 409 });
  }

  const parsed = parseMoveOutInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const now = new Date();
  // A day's grace for time zones: "today" in Hawaii is tomorrow on the server.
  if (input.movedOutOn > isoDay(new Date(now.getTime() + 86_400_000))) {
    return NextResponse.json(
      { error: "Record a move-out once they've gone — that date is still to come." },
      { status: 400 }
    );
  }
  if (input.lastRentMonth > currentMonthOf(now)) {
    return NextResponse.json(
      { error: "Rent can't be charged for a month that hasn't started. Pick this month or earlier." },
      { status: 400 }
    );
  }

  const result = await statementForTenant(id, now, { lastRentMonth: input.lastRentMonth });
  const owed = Math.max(0, result?.statement.balance ?? 0);
  const appliesToRent = input.deductions.some((d) => d.kind === "rent");
  if (appliesToRent && result?.problem) {
    return NextResponse.json({ error: result.problem }, { status: 409 });
  }
  const settled = settle(tenant.deposit, owed, input.deductions);
  if (!settled.ok) return NextResponse.json({ error: settled.error }, { status: 400 });

  // The deposit's entries land inside the tenancy's last rent month, even when
  // the keys came back later: the statement stops at that month (anything
  // after it at this place could be the next tenant's), so an entry dated
  // after it would be income in the ledger that never reached their account.
  const entryDay =
    input.movedOutOn < lastDayOf(input.lastRentMonth) ? input.movedOutOn : lastDayOf(input.lastRentMonth);
  const date = new Date(`${entryDay}T00:00:00.000Z`);
  const month = entryDay.slice(0, 7);
  const note = `Kept from ${tenant.name}'s deposit`;

  let made;
  try {
    made = await prisma.$transaction(async (tx) => {
      const moveOut = await tx.moveOut.create({
        data: {
          tenantId: id,
          movedOutOn: date,
          lastRentMonth: input.lastRentMonth,
          deposit: settled.value.deposit,
          refund: settled.value.refund,
          returnBy: input.returnBy ? new Date(`${input.returnBy}T00:00:00.000Z`) : null,
          forwardingAddress: input.forwardingAddress,
          createdById: userId,
          deductions: { create: input.deductions },
        },
        include: moveOutInclude,
      });

      // Every dollar kept is income, as a rent entry against their place — so
      // it counts toward what they've paid, and toward the year's rental
      // income on the tax export, which is where the IRS says it belongs.
      // A damage charge is also added to what they owe, so the two cancel on
      // their statement and it reads: charged $185 for cleaning, paid from
      // the deposit.
      const entries = [];
      for (const d of input.deductions) {
        if (d.kind === "charge") {
          await tx.tenantCharge.create({
            data: {
              tenantId: id,
              kind: "fee",
              month,
              label: d.label,
              amount: d.amount,
              raisedById: userId,
              moveOutId: moveOut.id,
            },
          });
        }
        entries.push(
          await tx.transaction.create({
            data: {
              propertyId: tenant.propertyId,
              unitId: tenant.unitId,
              createdById: userId,
              type: "rent",
              date,
              amount: d.amount,
              detail: d.kind === "rent" ? "Security deposit applied to rent" : `Security deposit: ${d.label}`,
              note,
              moveOutId: moveOut.id,
            },
          })
        );
      }

      const updated = await tx.tenant.update({ where: { id }, data: { active: false } });
      // The place stands empty from when rent stops — so the vacancy's cost
      // never counts days the tenant was paying for.
      const madeVacant = await markVacantAfterMoveOut(
        tx,
        { propertyId: tenant.propertyId, unitId: tenant.unitId, tenantId: id },
        new Date(`${vacancyStart(input.movedOutOn, input.lastRentMonth)}T00:00:00.000Z`)
      );
      if (madeVacant) await tx.moveOut.update({ where: { id: moveOut.id }, data: { madeVacant } });
      return { moveOut: { ...moveOut, madeVacant }, entries, tenant: updated, madeVacant };
    });
  } catch (e) {
    // Two taps racing: the unique index on the tenant is what stops a second one.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: `${tenant.name}'s move-out is already recorded.` }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json(
    {
      moveOut: serializeMoveOut(made.moveOut),
      tenant: serializeTenant(made.tenant),
      transactions: made.entries.map(serializeLedgerEntry),
      settlement: settled.value,
      // So the page can show the place as vacant without a reload.
      vacantSince: made.madeVacant ? vacancyStart(input.movedOutOn, input.lastRentMonth) : null,
    },
    { status: 201 }
  );
}

/** Marks the deposit returned (or not), and keeps the forwarding address. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const existing = await prisma.moveOut.findUnique({ where: { tenantId: id } });
  if (!existing) return NextResponse.json({ error: "No move-out recorded." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const data: { returnedOn?: Date | null; returnNote?: string | null; forwardingAddress?: string | null } = {};
  if ("returnedOn" in body) {
    if (body.returnedOn === null || body.returnedOn === "") data.returnedOn = null;
    else if (typeof body.returnedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.returnedOn)) {
      const d = new Date(`${body.returnedOn}T00:00:00.000Z`);
      if (isNaN(d.getTime())) return NextResponse.json({ error: "That date isn't valid." }, { status: 400 });
      if (d < existing.movedOutOn) {
        return NextResponse.json({ error: "It can't have gone back before they moved out." }, { status: 400 });
      }
      data.returnedOn = d;
    } else return NextResponse.json({ error: "That date isn't valid." }, { status: 400 });
  }
  if ("returnNote" in body) {
    data.returnNote = typeof body.returnNote === "string" ? body.returnNote.trim().slice(0, 200) || null : null;
  }
  if ("forwardingAddress" in body) {
    data.forwardingAddress =
      typeof body.forwardingAddress === "string" ? body.forwardingAddress.trim().slice(0, 300) || null : null;
  }

  const updated = await prisma.moveOut.update({ where: { id: existing.id }, data, include: moveOutInclude });
  return NextResponse.json(serializeMoveOut(updated));
}

/**
 * Undoes a move-out recorded by mistake: the deposit income and charges it
 * wrote come out, and the tenant is current again. Refused when someone
 * else now lives there, because two current tenants on one place is a state
 * the books can't split.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tenant = await requireTenant(userId, id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const existing = await prisma.moveOut.findUnique({ where: { tenantId: id } });
  if (!existing) return NextResponse.json({ error: "No move-out recorded." }, { status: 404 });

  const successor = await prisma.tenant.findFirst({
    where: { propertyId: tenant.propertyId, unitId: tenant.unitId, active: true, id: { not: id } },
    select: { name: true },
  });
  if (successor) {
    return NextResponse.json(
      {
        error: `${successor.name} is the current tenant there now. Move them to past tenants first, or leave this move-out as it is.`,
      },
      { status: 409 }
    );
  }

  let removed: { id: string }[] = [];
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      removed = await tx.transaction.findMany({ where: { moveOutId: existing.id }, select: { id: true } });
      await tx.transaction.deleteMany({ where: { moveOutId: existing.id } });
      await tx.tenantCharge.deleteMany({ where: { moveOutId: existing.id } });
      await tx.moveOut.delete({ where: { id: existing.id } });
      // Only a vacancy this move-out created: one the landlord set by hand
      // before it isn't this undo's to clear.
      if (existing.madeVacant) await clearVacancy(tx, { propertyId: tenant.propertyId, unitId: tenant.unitId });
      return tx.tenant.update({ where: { id }, data: { active: true } });
    });
  } catch (e) {
    // Undone twice at once: the other request already did it.
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "That move-out was already undone." }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({
    tenant: serializeTenant(updated),
    transactionIds: removed.map((t) => t.id),
    vacancyCleared: existing.madeVacant,
  });
}
