import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { validRent } from "@/lib/money";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const units = await prisma.unit.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(units);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const monthlyRent = Number(body?.monthlyRent) || 0;
  if (!validRent(monthlyRent)) {
    return NextResponse.json({ error: "Enter a valid monthly rent." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Unit name is required." }, { status: 400 });
  }

  const unit = await prisma.unit.create({ data: { propertyId: id, name, monthlyRent } });
  return NextResponse.json(unit, { status: 201 });
}
