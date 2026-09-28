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

export async function PATCH(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id, userId } = await params;
  const m = await membership(id, userId);
  if (!m) return NextResponse.json({ error: "They aren't on that LLC." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const role = body?.role === "owner" ? "owner" : "member";
  if (m.role === "owner" && role === "member") {
    const owners = await prisma.companyMember.count({ where: { companyId: id, role: "owner" } });
    if (owners <= 1) {
      return NextResponse.json({ error: "That's the only owner — make someone else an owner first." }, { status: 400 });
    }
  }
  await prisma.companyMember.update({ where: { companyId_userId: { companyId: id, userId } }, data: { role } });
  await logAdmin(admin, "company.member.role", m.company.name, `${m.user.email} is now ${role}`);
  return NextResponse.json(await adminSnapshot());
}

/**
 * Takes an account off an LLC. Never the last person on it — that would
 * leave the LLC's books reachable by nobody; deleting the LLC is the honest
 * version of that — and never the only owner while others remain.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id, userId } = await params;
  const m = await membership(id, userId);
  if (!m) return NextResponse.json({ error: "They aren't on that LLC." }, { status: 404 });

  const members = await prisma.companyMember.findMany({ where: { companyId: id } });
  if (members.length <= 1) {
    return NextResponse.json(
      { error: "They're the only person on this LLC. Add someone else first, or delete the LLC instead." },
      { status: 400 }
    );
  }
  if (m.role === "owner" && !members.some((x) => x.userId !== userId && x.role === "owner")) {
    return NextResponse.json({ error: "That's the only owner — make someone else an owner first." }, { status: 400 });
  }
  await prisma.companyMember.delete({ where: { companyId_userId: { companyId: id, userId } } });
  await logAdmin(admin, "company.member.remove", m.company.name, m.user.email);
  return NextResponse.json(await adminSnapshot());
}
