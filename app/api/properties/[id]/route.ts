import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const monthlyRent = Number(body?.monthlyRent);

  if (!name) {
    return NextResponse.json({ error: "Property name is required." }, { status: 400 });
  }
  if (!Number.isFinite(monthlyRent) || monthlyRent < 0) {
    return NextResponse.json({ error: "Enter a valid monthly rent." }, { status: 400 });
  }

  const data: { name: string; address: string | null; monthlyRent: number; vacant?: boolean } = {
    name,
    address: address || null,
    monthlyRent,
  };
  if (body?.vacant !== undefined) data.vacant = Boolean(body.vacant);

  const property = await prisma.property.update({ where: { id }, data });
  return NextResponse.json({ ...property, address: property.address ?? "" });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.property.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
