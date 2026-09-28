import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { clientIp, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { newResetToken, resetLink, siteOrigin } from "@/lib/password-reset";
import { emailConfigured, resetEmail, sendEmail } from "@/lib/email";

/** Asks for a reset link from one address, at most, this many times in the throttle window. */
const MAX_FORGOT_PER_IP = 10;

/**
 * "I forgot my password." Always answers the same way whether or not the
 * address has an account, so the form can't be used to learn which emails
 * are signed up. What it does say is whether this site can send email at
 * all — that is about the site, not the address.
 */
export async function POST(req: Request) {
  const key = `forgot:${clientIp(req.headers) ?? "unknown"}`;
  const paused = await isThrottled([key]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });
  await recordFailure([{ key, max: MAX_FORGOT_PER_IP }]);

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.length > 200) {
    return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  }

  const configured = emailConfigured();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } }).catch(() => null);

  // Same time spent either way: a lookup miss must not answer faster than a
  // hit, or the timing says what the words don't.
  if (!user) await bcrypt.hash(email, 6);

  if (user && configured) {
    const { token, tokenHash, expiresAt } = newResetToken();
    await prisma.$transaction([
      prisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } }),
      prisma.passwordReset.create({ data: { userId: user.id, tokenHash, expiresAt, issuedBy: "self" } }),
    ]);
    const link = resetLink(siteOrigin(req.url), token);
    // A send that fails is not reported: the answer below is the same for
    // everyone, and the person can ask again or ask the site admin.
    await sendEmail({ to: email, ...resetEmail(link) });
  }

  return NextResponse.json({ ok: true, emailConfigured: configured });
}
