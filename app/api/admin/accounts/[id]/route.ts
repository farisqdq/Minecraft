import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, companyFileUrls, logAdmin, requireAdmin } from "@/lib/admin-db";
import { planAccountDeletion } from "@/lib/admin";
import { releaseBlob } from "@/lib/blob-release";

/**
 * Account-level actions: admin on or off, sign out everywhere, two-factor
 * off. The last two are how a locked-out landlord gets back in without a
 * developer touching the database. None of them may be aimed at the admin's
 * own account: their own settings page asks for the password and a code
 * for exactly these, so a session left open on someone else's screen can't
 * be used to take the account over.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Nothing to do." }, { status: 400 });

  // The email is how they sign in and where reset links go, so it's the one
  // detail worth an admin's hand — a landlord who lost the old inbox is
  // otherwise locked out for good. Kept in the same shape signup requires.
  if (typeof body.email === "string" || typeof body.name === "string") {
    const changes: { email?: string; name?: string | null } = {};
    const detail: string[] = [];
    if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!email.includes("@") || email.length > 200) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      }
      if (email !== target.email) {
        changes.email = email;
        detail.push(`email was ${target.email}`);
      }
    }
    if (typeof body.name === "string") {
      const name = body.name.trim().slice(0, 120);
      if (name !== (target.name ?? "")) {
        changes.name = name || null;
        detail.push(`name was ${target.name || "blank"}`);
      }
    }
    if (Object.keys(changes).length > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id }, data: changes });
          await logAdmin(admin, "account.edit", changes.email ?? target.email, detail.join(", "), tx);
        });
      } catch (e) {
        if ((e as { code?: string })?.code === "P2002") {
          return NextResponse.json({ error: "Another account already uses that email." }, { status: 409 });
        }
        throw e;
      }
    }
  }

  const destructive = typeof body.isAdmin === "boolean" || body.signOutEverywhere === true || body.twoFactor === "off";
  if (destructive && target.id === admin.id) {
    return NextResponse.json(
      { error: "Not on your own account from here — use Account & security, which asks for your password." },
      { status: 400 }
    );
  }

  if (typeof body.isAdmin === "boolean") {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isAdmin: body.isAdmin as boolean } });
      await logAdmin(admin, body.isAdmin ? "account.admin.grant" : "account.admin.revoke", target.email, null, tx);
    });
  }
  if (body.signOutEverywhere === true) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
      await logAdmin(admin, "account.signOutEverywhere", target.email, null, tx);
    });
  }
  if (body.twoFactor === "off") {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] },
      });
      await logAdmin(admin, "account.twoFactor.off", target.email, null, tx);
    });
  }
  return NextResponse.json(await adminSnapshot());
}

class Changed extends Error {}

/**
 * Deletes an account. The body must carry the account's email, typed: the
 * panel asks for it, and the server insists, so a wrong click can't do this.
 *
 * LLCs the account is the only member of go with it — nobody could ever
 * reach them otherwise. LLCs with teammates keep them, and if this account
 * was their only owner the longest-standing member becomes one, so no LLC
 * is left that nobody can manage. The plan is worked out inside the
 * transaction from what's there at that moment, and each LLC is deleted
 * only if it is still one-person at the instant of the delete: someone who
 * joined it a second ago is not deleted along with it. The log line is in
 * the same transaction, so a deletion that happened is always written down.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  if (id === admin.id) return NextResponse.json({ error: "You can't delete your own account from here." }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });
  if (target.isAdmin) {
    return NextResponse.json({ error: "That account is an admin. Remove admin from it first." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const typed = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (typed !== target.email.toLowerCase()) {
    return NextResponse.json({ error: "Type the account's email address exactly to confirm." }, { status: 400 });
  }

  let plan: ReturnType<typeof planAccountDeletion> = { deleteCompanies: [], leaveCompanies: [] };
  let files: string[] = [];
  try {
    plan = await prisma.$transaction(async (tx) => {
      const memberships = await tx.companyMember.findMany({
        where: { userId: id },
        include: { company: { include: { members: true } } },
      });
      const p = planAccountDeletion(
        id,
        memberships.map((m) => ({
          id: m.company.id,
          name: m.company.name,
          members: m.company.members.map((x) => ({ userId: x.userId, role: x.role, createdAt: x.createdAt.toISOString() })),
        }))
      );
      for (const c of p.deleteCompanies) {
        // Files first (the rows are about to cascade away), then the LLC —
        // only while it is still one-person.
        files.push(...(await companyFileUrls(tx, c.id)));
        const gone = await tx.company.deleteMany({ where: { id: c.id, members: { none: { userId: { not: id } } } } });
        if (gone.count !== 1) throw new Changed();
      }
      for (const c of p.leaveCompanies) {
        if (c.promote) {
          await tx.companyMember.update({
            where: { companyId_userId: { companyId: c.id, userId: c.promote } },
            data: { role: "owner" },
          });
        }
      }
      const detail = [
        p.deleteCompanies.length ? `deleted ${p.deleteCompanies.map((c) => c.name).join(", ")}` : "",
        p.leaveCompanies.length ? `left ${p.leaveCompanies.map((c) => c.name).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      await logAdmin(admin, "account.delete", target.email, detail, tx);
      // Memberships cascade with the account.
      await tx.user.delete({ where: { id } });
      return p;
    });
  } catch (e) {
    if (e instanceof Changed) {
      return NextResponse.json(
        { error: "Someone joined one of their LLCs just now, so nothing was deleted. Look again and retry." },
        { status: 409 }
      );
    }
    throw e;
  }

  // After the commit: releaseBlob leaves any file another row still uses.
  for (const url of files) await releaseBlob(url).catch(() => false);

  return NextResponse.json({ ...(await adminSnapshot()), plan });
}
