import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireAsset } from "@/lib/access";
import { parseAssetInput } from "@/lib/depreciation";
import { serializeAsset } from "@/lib/assets-db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await requireAsset(userId, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseAssetInput({
    kind: existing.kind,
    label: existing.label,
    cls: existing.cls,
    basis: existing.basis,
    inService: existing.inService,
    note: existing.note ?? "",
    ...(body ?? {}),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const asset = await prisma.depreciableAsset.update({ where: { id }, data: parsed.value });
  return NextResponse.json(serializeAsset(asset));
}

/** Changes past years' deductions in the export, so it takes an owner. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireAsset(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await requireAsset(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner of this LLC can remove it." }, { status: 403 });
  }
  await prisma.depreciableAsset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
