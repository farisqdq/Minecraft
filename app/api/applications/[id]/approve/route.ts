import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireApplication } from "@/lib/access";
import { approveApplication } from "@/lib/listings-db";
import { MAX_AMOUNT } from "@/lib/money";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (s: unknown): s is string =>
  typeof s === "string" && ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Approves an applicant: they become the tenant of the listed place, on the
 * lease given here, at the listing's rent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireApplication(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const deposit = Number(body?.deposit ?? 0);
  const dueDay = Number(body?.dueDay ?? 1);
  if (!valid(body?.leaseStart) || !valid(body?.leaseEnd)) return NextResponse.json({ error: "Choose when the lease starts and ends." }, { status: 400 });
  if (body.leaseEnd <= body.leaseStart) return NextResponse.json({ error: "The lease has to end after it starts." }, { status: 400 });
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > MAX_AMOUNT) return NextResponse.json({ error: "The deposit has to be zero or more." }, { status: 400 });
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return NextResponse.json({ error: "Rent is due on a day from 1 to 31." }, { status: 400 });

  const result = await approveApplication(userId, id, {
    leaseStart: body.leaseStart,
    leaseEnd: body.leaseEnd,
    deposit: Math.round(deposit * 100) / 100,
    dueDay,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result, { status: 201 });
}
