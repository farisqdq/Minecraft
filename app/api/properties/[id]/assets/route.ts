import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { parseAssetInput } from "@/lib/depreciation";
import { serializeAsset } from "@/lib/assets-db";

/** Adds the building, or an improvement to it, to what's depreciated. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireProperty(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseAssetInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const asset = await prisma.depreciableAsset.create({
    data: { ...parsed.value, propertyId: id, createdById: userId },
  });
  return NextResponse.json(serializeAsset(asset), { status: 201 });
}
