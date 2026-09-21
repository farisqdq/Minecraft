import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { generateJoinCode } from "@/lib/codes";
import { inviteExpiry, NO_ACCESS, type PortalAccess } from "@/lib/portal";

const day = (d: Date | null | undefined) => (d ? d.toISOString() : "");

async function readAccess(tenantId: string): Promise<PortalAccess> {
  const [account, invite] = await Promise.all([
    prisma.tenantAccount.findUnique({ where: { tenantId } }),
    prisma.tenantInvite.findFirst({
      where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    ...NO_ACCESS,
    inviteCode: invite?.code ?? "",
    inviteExpires: day(invite?.expiresAt),
    accountEmail: account?.email ?? "",
    accountSince: day(account?.createdAt),
    lastLoginAt: day(account?.lastLoginAt),
  };
}

/** Where the tenant card reads its "Portal access" line from. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(await readAccess(id));
}

/**
 * Issue a fresh invite code for this tenant.
 *
 * This is the only door to a TenantAccount. A code names one tenant, so
 * redeeming it can only ever produce a login for that tenant's unit — there
 * is no form anywhere that lets someone choose which place they live in.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tenant = await requireTenant(userId, id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!tenant.active) {
    return NextResponse.json(
      { error: "That tenant has moved out. Mark them back in first." },
      { status: 400 }
    );
  }

  const existing = await prisma.tenantAccount.findUnique({ where: { tenantId: id } });
  if (existing) {
    return NextResponse.json(
      { error: `${tenant.name} already has portal access.` },
      { status: 409 }
    );
  }

  // Issuing a new code retires the old one, so a code you shared and thought
  // better of stops working the moment you generate its replacement.
  await prisma.tenantInvite.deleteMany({ where: { tenantId: id, acceptedAt: null } });
  await prisma.tenantInvite.create({
    data: {
      tenantId: id,
      code: generateJoinCode(),
      invitedById: userId,
      expiresAt: inviteExpiry(),
    },
  });

  return NextResponse.json(await readAccess(id), { status: 201 });
}

/**
 * Start them over with a new code when they've forgotten their password.
 *
 * There is no "email me a reset link" here because there is no mail being
 * sent — you hand out the code the same way you did the first one. Deleting
 * the account is safe: everything they reported hangs off their tenant row,
 * not off the login, so the history is all still there when they sign back
 * in under a new password.
 */
export async function PUT(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tenant = await requireTenant(userId, id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!tenant.active) {
    return NextResponse.json(
      { error: "That tenant has moved out. Mark them back in first." },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.tenantAccount.deleteMany({ where: { tenantId: id } }),
    prisma.tenantInvite.deleteMany({ where: { tenantId: id } }),
    prisma.tenantInvite.create({
      data: {
        tenantId: id,
        code: generateJoinCode(),
        invitedById: userId,
        expiresAt: inviteExpiry(),
      },
    }),
  ]);

  return NextResponse.json(await readAccess(id));
}

/**
 * Take portal access away: deletes the account and any unused code. Their
 * tenant record, lease and ledger history are untouched — this is only the
 * login.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.tenantAccount.deleteMany({ where: { tenantId: id } }),
    prisma.tenantInvite.deleteMany({ where: { tenantId: id } }),
  ]);

  return NextResponse.json(NO_ACCESS);
}
