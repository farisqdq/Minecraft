import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return NextResponse.json({ error: "No such LLC." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Enter a name for the LLC." }, { status: 400 });

  await prisma.company.update({ where: { id }, data: { name } });
  await logAdmin(admin, "company.rename", name, `was ${company.name}`);
  return NextResponse.json(await adminSnapshot());
}

/**
 * Deletes an LLC and everything under it — properties, ledger, tenants,
 * repairs — for everyone on its team. The body must carry the LLC's name,
 * typed, as the Team page asks of an owner.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: { properties: { select: { _count: { select: { transactions: true } } } } },
  });
  if (!company) return NextResponse.json({ error: "No such LLC." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const typed = typeof body?.name === "string" ? body.name.trim() : "";
  if (typed !== company.name) {
    return NextResponse.json({ error: "Type the LLC's name exactly to confirm." }, { status: 400 });
  }

  const entries = company.properties.reduce((sum, p) => sum + p._count.transactions, 0);
  await prisma.company.delete({ where: { id } });
  await logAdmin(
    admin,
    "company.delete",
    company.name,
    `${company.properties.length} ${company.properties.length === 1 ? "property" : "properties"}, ${entries} ledger ${entries === 1 ? "entry" : "entries"}`
  );
  return NextResponse.json(await adminSnapshot());
}
