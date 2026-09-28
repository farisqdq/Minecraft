import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdmin, requireAdmin } from "@/lib/admin-db";
import { newResetToken, resetLink, siteOrigin } from "@/lib/password-reset";

/**
 * A reset link an admin can hand to someone who is locked out — over the
 * phone, by text, however they already talk. It needs no email set up,
 * which is the point: the site had none the day this was written.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });

  const { token, tokenHash, expiresAt } = newResetToken();
  await prisma.$transaction([
    prisma.passwordReset.deleteMany({ where: { userId: id, usedAt: null } }),
    prisma.passwordReset.create({ data: { userId: id, tokenHash, expiresAt, issuedBy: admin.email } }),
  ]);
  await logAdmin(admin, "account.resetLink", target.email);
  return NextResponse.json({ link: resetLink(siteOrigin(req.url), token), expiresAt: expiresAt.toISOString() });
}
