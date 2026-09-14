import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, userId } = await params;
  if (!(await requireCompany(currentUserId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner can change roles." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const role = body?.role === "owner" ? "owner" : "member";

  const target = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: id, userId } },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (target.role === "owner" && role === "member") {
    const owners = await prisma.companyMember.count({ where: { companyId: id, role: "owner" } });
    if (owners <= 1) {
      return NextResponse.json(
        { error: "This is the only owner — make someone else an owner first." },
        { status: 400 }
      );
    }
  }

  await prisma.companyMember.update({
    where: { companyId_userId: { companyId: id, userId } },
    data: { role },
  });
  return NextResponse.json({ ok: true, role });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, userId } = await params;

  // Owners can remove anyone; anyone can remove themselves (leave the LLC).
  const isOwner = Boolean(await requireCompany(currentUserId, id, "owner"));
  if (!isOwner && currentUserId !== userId) {
    return NextResponse.json({ error: "Only an owner can remove teammates." }, { status: 403 });
  }
  if (!(await requireCompany(currentUserId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const owners = await prisma.companyMember.count({ where: { companyId: id, role: "owner" } });
  const target = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: id, userId } },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role === "owner" && owners <= 1) {
    return NextResponse.json(
      { error: "This is the only owner — make someone else an owner first." },
      { status: 400 }
    );
  }

  await prisma.companyMember.delete({
    where: { companyId_userId: { companyId: id, userId } },
  });
  return NextResponse.json({ ok: true });
}
