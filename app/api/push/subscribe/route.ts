import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenantSession } from "@/lib/tenant-access";

type Who = { userId: string } | { tenantAccountId: string };

/** Whose device this is: a landlord's or a tenant login's. */
async function owner(): Promise<Who | null> {
  const userId = await getCurrentUserId();
  if (userId) return { userId };
  const tenant = await requireTenantSession();
  if (tenant) return { tenantAccountId: tenant.accountId };
  return null;
}

const ownedBy = (row: { userId: string | null; tenantAccountId: string | null }, who: Who) =>
  "userId" in who ? row.userId === who.userId : row.tenantAccountId === who.tenantAccountId;

/** More than this and something is registering in a loop. */
const MAX_DEVICES = 10;

/**
 * Register (or re-register) this device for the signed-in person.
 *
 * With `sync: true` — sent by the settings page every time it opens — it
 * only refreshes a row that is already this person's, and answers
 * `registered: false` when there isn't one (the push service said the
 * device was gone and it was removed, or an admin removed it, or another
 * login on this phone has it). The page then shows the true state instead
 * of "on" for a device nothing will ever reach.
 *
 * `replaces` names the endpoint this one supersedes (a subscription thrown
 * away because it was made with an old key), so its row goes too.
 */
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
  const rawAgent = typeof body?.userAgent === "string" ? body.userAgent.slice(0, 200) : null;
  // Whether it was opened from the home screen can't be read from the user
  // agent later, so it rides along on the end of it.
  const userAgent = rawAgent && body?.installed === true ? `${rawAgent.slice(0, 185)} [installed]` : rawAgent;
  const replaces = typeof body?.replaces === "string" && body.replaces !== endpoint ? body.replaces : "";

  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });

  if (body?.sync === true && (!existing || !ownedBy(existing, who))) {
    const devices = await prisma.pushSubscription.count({ where: who });
    return NextResponse.json({ ok: true, registered: false, elsewhere: Boolean(existing), devices });
  }

  // An endpoint belongs to one person: re-registering from another login on
  // the same phone moves it over rather than leaving two owners.
  const ownerFields = { ...who, ...("userId" in who ? { tenantAccountId: null } : { userId: null }) };
  if (existing) {
    // New keys mean a new subscription: what happened to the old one says
    // nothing about this one. The same keys (a settings page re-checking)
    // keep their history.
    const fresh = existing.p256dh !== p256dh || existing.auth !== auth;
    await prisma.pushSubscription.update({
      where: { endpoint },
      data: {
        p256dh,
        auth,
        userAgent,
        ...ownerFields,
        ...(fresh || !ownedBy(existing, who) ? { lastUsedAt: null, lastError: null, lastErrorAt: null } : {}),
      },
    });
  } else {
    await prisma.pushSubscription
      .create({ data: { endpoint, p256dh, auth, userAgent, ...ownerFields } })
      .catch(async (e) => {
        // Two tabs registering the same phone at once: the other one won.
        if ((e as { code?: string })?.code !== "P2002") throw e;
      });
  }
  if (replaces) await prisma.pushSubscription.deleteMany({ where: { endpoint: replaces, ...who } });
  const extra = await prisma.pushSubscription.findMany({ where: who, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES, select: { id: true } });
  if (extra.length > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  const devices = await prisma.pushSubscription.count({ where: who });
  return NextResponse.json({ ok: true, registered: true, devices });
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
