import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";

type Params = { params: Promise<{ id: string; userId: string }> };

async function membership(id: string, userId: string) {
  return prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: id, userId } },
    include: { company: { select: { name: true } }, user: { select: { email: true } } },
  });
}

const ONLY_OWNER = "That's the only owner — make someone else an owner first.";

/**
 * The two rules an LLC's team is never allowed to break — never without
 * an owner, never without anyone — are enforced by the write itself, not
 * by a check before it: the update or delete matches only while another
 * owner (or another person) is on the LLC at that instant, so two admins
 * acting at once can't strand it between them.
 */
export async function PATCH(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id, userId } = await params;
  const m = await membership(id, userId);
  if (!m) return NextResponse.json({ error: "They aren't on that LLC." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const role = body?.role === "owner" ? "owner" : "member";

  const ok = await prisma.$transaction(async (tx) => {
    const changed = await tx.companyMember.updateMany({
      where:
        role === "member"
          ? { companyId: id, userId, company: { members: { some: { userId: { not: userId }, role: "owner" } } } }
          : { companyId: id, userId },
      data: { role },
    });
    if (changed.count !== 1) return false;
    await logAdmin(admin, "company.member.role", m.company.name, `${m.user.email} is now ${role}`, tx);
    return true;
  });
  if (!ok) return NextResponse.json({ error: ONLY_OWNER }, { status: 400 });
  return NextResponse.json(await adminSnapshot());
}

export async function DELETE(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id, userId } = await params;
  const m = await membership(id, userId);
  if (!m) return NextResponse.json({ error: "They aren't on that LLC." }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    const others = await tx.companyMember.count({ where: { companyId: id, userId: { not: userId } } });
    if (others === 0) return "alone";
    const removed = await tx.companyMember.deleteMany({
      where: {
        companyId: id,
        userId,
        // Someone else must remain — and if this is an owner, another owner.
        company: {
          members: {
            some: m.role === "owner" ? { userId: { not: userId }, role: "owner" } : { userId: { not: userId } },
          },
        },
      },
    });
    if (removed.count !== 1) return "owner";
    await logAdmin(admin, "company.member.remove", m.company.name, m.user.email, tx);
    return "ok";
  });
  if (result === "alone") {
    return NextResponse.json(
      { error: "They're the only person on this LLC. Add someone else first, or delete the LLC instead." },
      { status: 400 }
    );
  }
  if (result === "owner") return NextResponse.json({ error: ONLY_OWNER }, { status: 400 });
  return NextResponse.json(await adminSnapshot());
}
