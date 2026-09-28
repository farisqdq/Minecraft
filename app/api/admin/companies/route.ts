import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";

/** Creates an LLC owned by the account named — "set this person up with an LLC". */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const ownerUserId = typeof body?.ownerUserId === "string" ? body.ownerUserId : "";
  if (!name) return NextResponse.json({ error: "Enter a name for the LLC." }, { status: 400 });
  const owner = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { id: true, email: true } });
  if (!owner) return NextResponse.json({ error: "Pick the account that owns it." }, { status: 400 });

  await prisma.company.create({ data: { name, members: { create: { userId: owner.id, role: "owner" } } } });
  await logAdmin(admin, "company.create", name, `owned by ${owner.email}`);
  return NextResponse.json(await adminSnapshot(), { status: 201 });
}
