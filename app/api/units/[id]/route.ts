import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireUnit } from "@/lib/access";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireUnit(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const data: { name?: string; monthlyRent?: number; vacant?: boolean } = {};

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Unit name is required." }, { status: 400 });
    data.name = name;
  }
  if (body?.monthlyRent !== undefined) {
    const rent = Number(body.monthlyRent);
    if (!Number.isFinite(rent) || rent < 0) {
      return NextResponse.json({ error: "Enter a valid monthly rent." }, { status: 400 });
    }
    data.monthlyRent = rent;
  }
  if (body?.vacant !== undefined) {
    data.vacant = Boolean(body.vacant);
  }

  const unit = await prisma.unit.update({ where: { id }, data });
  return NextResponse.json(unit);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireUnit(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.unit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
