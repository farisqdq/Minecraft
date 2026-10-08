import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { parsePolicy } from "@/lib/late-fee-policy";
import { policyDTO } from "@/lib/statements";
import { runLateFeesForCompany } from "@/lib/late-fees-db";

/**
 * The company's late-fee policy: what every tenant on "default" is charged
 * when rent is late. Saving applies it straight away to every tenant of the
 * LLC; after that the daily job (/api/cron/reminders) keeps it up to date.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireCompany(userId, id, "viewer"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(policyDTO(await prisma.lateFeePolicy.findUnique({ where: { companyId: id } })));
}

/** Owners only: it bills every tenant of the LLC without anyone pressing a button. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner can change late fees." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const current = policyDTO(await prisma.lateFeePolicy.findUnique({ where: { companyId: id } }));
  const next = parsePolicy(body, current);
  if (next.enabled && !(next.percent > 0) && !(next.dailyAmount > 0)) {
    return NextResponse.json(
      { error: "Enter a one-time fee or a daily amount, or switch late fees off." },
      { status: 400 }
    );
  }
  const saved = await prisma.lateFeePolicy.upsert({
    where: { companyId: id },
    create: { companyId: id, ...next },
    update: next,
  });
  // Apply it now rather than at tomorrow's daily run: overdue rent gets its
  // fee the moment the policy is on. Idempotent (lib/late-fees-db), so a
  // second save changes nothing already charged.
  const report = await runLateFeesForCompany(id);
  return NextResponse.json({ ...policyDTO(saved), report });
}
