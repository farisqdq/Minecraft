import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { companyIdsForUser, requireCompany } from "@/lib/access";
import { readVendor, vendorsForCompanies } from "@/lib/vendors-db";

/** A sane ceiling on one LLC's book; nobody has 500 plumbers. */
const MAX_VENDORS = 200;

/** Every vendor across the companies you're on. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await vendorsForCompanies(await companyIdsForUser(userId)));
}


export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  if (!(await requireCompany(userId, companyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = readVendor(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if ((await prisma.vendor.count({ where: { companyId } })) >= MAX_VENDORS) {
    return NextResponse.json({ error: "That LLC's vendor book is full." }, { status: 400 });
  }

  const vendor = await prisma.vendor.create({
    data: { ...parsed.data, companyId, createdById: userId },
  });
  const [dto] = (await vendorsForCompanies([companyId])).filter((v) => v.id === vendor.id);
  return NextResponse.json(dto, { status: 201 });
}
