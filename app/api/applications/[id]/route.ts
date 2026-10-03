import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireApplication } from "@/lib/access";
import { serializeApplication } from "@/lib/listings-db";

/** Marks an application as being reviewed, declined, or new again. Approval has its own route. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const app = await requireApplication(userId, id);
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (status !== "new" && status !== "reviewing" && status !== "declined") {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }
  if (app.status === "approved") {
    return NextResponse.json({ error: `${app.name} is already a tenant; move them out from their card instead.` }, { status: 409 });
  }
  const saved = await prisma.rentalApplication.update({
    where: { id },
    data: { status, decidedById: status === "declined" ? userId : null, decidedAt: status === "declined" ? new Date() : null },
  });
  return NextResponse.json(serializeApplication(saved));
}

/** Deletes an application — someone's personal details — for good. Owners only. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireApplication(userId, id, "owner"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.rentalApplication.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
