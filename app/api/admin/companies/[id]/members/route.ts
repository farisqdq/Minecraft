import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";

/** Puts an account on an LLC's team, by its email or id, as owner or member. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!company) return NextResponse.json({ error: "No such LLC." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const role = body?.role === "owner" ? "owner" : "member";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    : email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
      : null;
  if (!user) {
    return NextResponse.json(
      { error: email ? `No account is signed up as ${email}. They need to create one first.` : "Pick an account." },
      { status: 404 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.companyMember.create({ data: { companyId: id, userId: user.id, role } });
      await logAdmin(admin, "company.member.add", company.name, `${user.email} as ${role}`, tx);
    });
  } catch (e) {
    // The unique index on (LLC, account) is what stops a double add.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: `${user.email} is already on ${company.name}.` }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json(await adminSnapshot(), { status: 201 });
}
