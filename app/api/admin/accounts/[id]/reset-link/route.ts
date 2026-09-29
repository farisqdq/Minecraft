import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";
import { newResetToken, resetLink } from "@/lib/password-reset";
import { siteOrigin } from "@/lib/site";

/**
 * A reset link an admin can hand to someone who is locked out — over the
 * phone, by text, however they already talk. It needs no email set up,
 * which is the point: the site had none the day this was written. The link
 * is never written down anywhere but the response.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, sessionVersion: true } });
  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });

  const { token, tokenHash, expiresAt } = newResetToken();
  const reset = await prisma.$transaction(async (tx) => {
    await tx.passwordReset.deleteMany({ where: { userId: id, usedAt: null } });
    const row = await tx.passwordReset.create({
      data: { userId: id, tokenHash, expiresAt, issuedBy: admin.email, sessionVersion: target.sessionVersion },
    });
    await logAdmin(admin, "account.resetLink", target.email, null, tx);
    return row;
  });
  return NextResponse.json({
    ...(await adminSnapshot()),
    link: resetLink(siteOrigin(req.url), token),
    // Lets "Send email" name this reset exactly (./email/route.ts), so what
    // is emailed is the link on screen and not a fresh one.
    resetId: reset.id,
    expiresAt: expiresAt.toISOString(),
  });
}
