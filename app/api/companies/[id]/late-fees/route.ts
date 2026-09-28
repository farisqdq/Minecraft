import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { parsePolicy } from "@/lib/late-fee-policy";
import { policyDTO } from "@/lib/statements";

/**
 * The company's late-fee policy: what every tenant on "default" is charged
 * when rent is late. Saving it changes nothing on its own — each tenant's
 * policy rule is brought in step the next time their statement is worked
 * out, which the daily reminder run does for everyone.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireCompany(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  return NextResponse.json(policyDTO(saved));
}
