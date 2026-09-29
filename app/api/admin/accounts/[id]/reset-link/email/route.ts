import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";
import { hashToken, plausibleToken, resetIsLive, resetLink } from "@/lib/password-reset";
import { siteOrigin } from "@/lib/site";
import { emailConfigured, sendEmail } from "@/lib/email";
import { isThrottled, recordFailure } from "@/lib/throttle";
import { adminMailKeys, adminResetEmail, mailPausedMessage, mailResultMessage, maskEmail } from "@/lib/admin-mail";

/**
 * Emails the reset link an admin was just shown to the account's own
 * address. Takes the reset's id and its token — the token only to rebuild
 * the same link, and only once its hash matches that live reset for this
 * account. The address, the origin and the words all come from here: the
 * client can't choose who gets mail from the site or what it says.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const resetId = typeof body?.resetId === "string" ? body.resetId : "";
  const token = body?.token;

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, sessionVersion: true } });
  if (!target) return NextResponse.json({ error: "No such account." }, { status: 404 });
  if (!target.email?.trim()) return NextResponse.json({ error: "No email on file." }, { status: 400 });

  const reset = resetId && plausibleToken(token) ? await prisma.passwordReset.findUnique({ where: { id: resetId } }) : null;
  if (
    !reset ||
    reset.userId !== target.id ||
    reset.issuedBy === "self" ||
    reset.tokenHash !== hashToken(token as string) ||
    reset.sessionVersion !== target.sessionVersion ||
    !resetIsLive(reset)
  ) {
    return NextResponse.json({ error: "That link isn't live any more — make a new one." }, { status: 409 });
  }

  const keys = adminMailKeys(admin.id, target.id);
  const paused = await isThrottled(keys.map((k) => k.key));
  if (paused > 0) return NextResponse.json({ error: mailPausedMessage(paused) }, { status: 429 });

  const masked = maskEmail(target.email);
  // Counted before the attempt, so the ceiling holds even when sends fail or
  // race; an unconfigured site sends nothing, so it isn't counted.
  if (emailConfigured()) await recordFailure(keys);
  const result = await sendEmail({ to: target.email, ...adminResetEmail(resetLink(siteOrigin(req.url), token as string)) });
  const message = mailResultMessage(result, masked);
  if (!result.sent) {
    return NextResponse.json(
      { sent: false, reason: result.reason, error: message },
      { status: result.reason === "unconfigured" ? 503 : 502 }
    );
  }

  await logAdmin(admin, "account.resetLink.email", target.email, `sent to ${masked}`);
  return NextResponse.json({ ...(await adminSnapshot()), sent: true, to: masked, message });
}
