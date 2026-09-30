import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminDevices, adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";

/**
 * Forgets one device: its row goes, and nothing is sent to it again. The
 * phone itself isn't told — if its owner still has notifications on there,
 * it registers again the next time they open their notification settings.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const device = (await adminDevices()).find((d) => d.id === id);
  if (!device) return NextResponse.json({ error: "That device is already gone." }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.pushSubscription.delete({ where: { id } });
    await logAdmin(admin, "push.device.remove", device.who, device.device, tx);
  });
  return NextResponse.json(await adminSnapshot());
}
