import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { releaseBlob } from "@/lib/blob-release";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: { transaction: true },
  });
  if (!attachment || !(await requireProperty(userId, attachment.transaction.propertyId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Row first, then the file — and the file only if no other record, in any
  // account, still links to it (see lib/blob-release.ts for why).
  await prisma.attachment.delete({ where: { id } });
  await releaseBlob(attachment.url);

  return NextResponse.json({ ok: true });
}
