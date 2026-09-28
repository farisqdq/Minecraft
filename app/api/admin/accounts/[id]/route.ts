import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";
import { planAccountDeletion } from "@/lib/admin";

/**
 * Account-level actions: admin on or off, sign out everywhere, two-factor
 * off. The last two are how a locked-out landlord gets back in without a
 * developer touching the database.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Nothing to do." }, { status: 400 });

  if (typeof body.isAdmin === "boolean") {
    // Nobody changes their own standing: an admin can't lock themselves
    // out by mistake, and can't quietly make themselves the only one.
    if (target.id === admin.id) {
      return NextResponse.json({ error: "Another admin has to change your own admin access." }, { status: 400 });
    }
    await prisma.user.update({ where: { id }, data: { isAdmin: body.isAdmin } });
    await logAdmin(admin, body.isAdmin ? "account.admin.grant" : "account.admin.revoke", target.email);
  }
  if (body.signOutEverywhere === true) {
    await prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    await logAdmin(admin, "account.signOutEverywhere", target.email);
  }
  if (body.twoFactor === "off") {
    await prisma.user.update({
      where: { id },
      data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] },
    });
    await logAdmin(admin, "account.twoFactor.off", target.email);
  }
  return NextResponse.json(await adminSnapshot());
}

/**
 * Deletes an account. The body must carry the account's email, typed: the
 * panel asks for it, and the server insists, so a wrong click can't do this.
 *
 * LLCs the account is the only member of go with it — nobody could ever
 * reach them otherwise. LLCs with teammates keep them, and if this account
 * was their only owner the longest-standing member becomes one, so no LLC
 * is left that nobody can manage. All in one transaction.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  if (id === admin.id) return NextResponse.json({ error: "You can't delete your own account from here." }, { status: 400 });
  const target = await prisma.user.findUnique({
    where: { id },
    include: { memberships: { include: { company: { include: { members: true } } } } },
  });
  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });
  if (target.isAdmin) {
    return NextResponse.json({ error: "That account is an admin. Remove admin from it first." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const typed = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (typed !== target.email.toLowerCase()) {
    return NextResponse.json({ error: "Type the account's email address exactly to confirm." }, { status: 400 });
  }

  const plan = planAccountDeletion(
    id,
    target.memberships.map((m) => ({
      id: m.company.id,
      name: m.company.name,
      members: m.company.members.map((x) => ({ userId: x.userId, role: x.role, createdAt: x.createdAt.toISOString() })),
    }))
  );

  await prisma.$transaction(async (tx) => {
    for (const c of plan.deleteCompanies) await tx.company.delete({ where: { id: c.id } });
    for (const c of plan.leaveCompanies) {
      if (c.promote) {
        await tx.companyMember.update({
          where: { companyId_userId: { companyId: c.id, userId: c.promote } },
          data: { role: "owner" },
        });
      }
    }
    // Memberships cascade with the account.
    await tx.user.delete({ where: { id } });
  });

  const detail = [
    plan.deleteCompanies.length
      ? `deleted ${plan.deleteCompanies.map((c) => c.name).join(", ")}`
      : "",
    plan.leaveCompanies.length ? `left ${plan.leaveCompanies.map((c) => c.name).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  await logAdmin(admin, "account.delete", target.email, detail);

  return NextResponse.json({ ...(await adminSnapshot()), plan });
}
