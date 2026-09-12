import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const properties = await prisma.property.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(properties);
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const monthlyRent = Number(body?.monthlyRent) || 0;

  if (!name) {
    return NextResponse.json({ error: "Property name is required." }, { status: 400 });
  }

  const property = await prisma.property.create({
    data: { userId, name, address: address || null, monthlyRent },
  });
  return NextResponse.json({ ...property, address: property.address ?? "" }, { status: 201 });
}
