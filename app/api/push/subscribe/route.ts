import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenantSession } from "@/lib/tenant-access";

/** Whose device this is: a landlord's or a tenant login's. */
async function owner(): Promise<{ userId: string } | { tenantAccountId: string } | null> {
  const userId = await getCurrentUserId();
  if (userId) return { userId };
  const tenant = await requireTenantSession();
  if (tenant) return { tenantAccountId: tenant.accountId };
  return null;
}

/** More than this and something is registering in a loop. */
const MAX_DEVICES = 10;

/** Register (or re-register) this device for the signed-in person. */
export async function POST(req: Request) {
  const who = await owner();
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return NextResponse.json({ error: "That isn't a push subscription." }, { status: 400 });
  }
  const userAgent = typeof body?.userAgent === "string" ? body.userAgent.slice(0, 200) : null;

  // An endpoint belongs to one person: re-registering from another login on
  // the same phone moves it over rather than leaving two owners.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh, auth, userAgent, ...who, ...("userId" in who ? { tenantAccountId: null } : { userId: null }) },
    update: { p256dh, auth, userAgent, lastUsedAt: null, ...who, ...("userId" in who ? { tenantAccountId: null } : { userId: null }) },
  });
  const extra = await prisma.pushSubscription.findMany({ where: who, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES, select: { id: true } });
  if (extra.length > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  const devices = await prisma.pushSubscription.count({ where: who });
  return NextResponse.json({ ok: true, devices });
}

/** Forget this device. Only its own owner can. */
export async function DELETE(req: Request) {
  const who = await owner();
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "Which device?" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint, ...who } });
  const devices = await prisma.pushSubscription.count({ where: who });
  return NextResponse.json({ ok: true, devices });
}

/** How many devices the signed-in person has enabled. */
export async function GET() {
  const who = await owner();
  if (!who) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const devices = await prisma.pushSubscription.count({ where: who });
  return NextResponse.json({ devices });
}
