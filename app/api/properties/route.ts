import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser, requireCompany } from "@/lib/access";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyIds = await companyIdsForUser(userId);
  const properties = await prisma.property.findMany({
    where: { companyId: { in: companyIds } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    properties.map((p) => ({ ...p, address: p.address ?? "" }))
  );
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  const monthlyRent = Number(body?.monthlyRent) || 0;

  if (!name) {
    return NextResponse.json({ error: "Property name is required." }, { status: 400 });
  }
  if (!companyId || !(await requireCompany(userId, companyId))) {
    return NextResponse.json({ error: "Pick an LLC you're on the team for." }, { status: 404 });
  }

  const property = await prisma.property.create({
    data: { companyId, createdById: userId, name, address: address || null, monthlyRent },
  });
  return NextResponse.json({ ...property, address: property.address ?? "" }, { status: 201 });
}
