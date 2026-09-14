import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireProperty } from "@/lib/access";
import { blobConfigured } from "@/lib/blob";

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

  if (blobConfigured()) {
    // A file left in storage is recoverable noise; a row pointing at a file
    // that's gone is a broken thumbnail, so drop the row either way.
    await del(attachment.url).catch(() => undefined);
  }
  await prisma.attachment.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
