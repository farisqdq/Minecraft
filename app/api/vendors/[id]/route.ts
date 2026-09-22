import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireVendor } from "@/lib/access";
import { readVendor, vendorsForCompanies } from "@/lib/vendors-db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const vendor = await requireVendor(userId, id);
  if (!vendor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = readVendor(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // The company never changes here: moving a vendor between LLCs would carry
  // one company's repair history into another's books.
  await prisma.vendor.update({ where: { id }, data: parsed.data });
  const [dto] = (await vendorsForCompanies([vendor.companyId])).filter((v) => v.id === id);
  return NextResponse.json(dto);
}

/**
 * Take someone out of the book. Their repairs and expenses stay — the money
 * was spent and the leak was fixed — they just stop naming who did it.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireVendor(userId, id, "owner"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.vendor.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
