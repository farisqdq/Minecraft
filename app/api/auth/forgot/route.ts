import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { newResetToken, resetLink } from "@/lib/password-reset";
import { siteOrigin } from "@/lib/site";
import { emailConfigured, resetEmail, sendEmail } from "@/lib/email";

/** Asks from one address, and asks about one email, at most this many times per window. */
const MAX_FORGOT_PER_IP = 10;
const MAX_FORGOT_PER_EMAIL = 3;
/** A link this fresh is left alone: another request doesn't retire it and doesn't send again. */
const FRESH_MS = 5 * 60 * 1000;

/**
 * "I forgot my password." Always answers the same way whether or not the
 * address has an account, and answers before doing anything about it: the
 * lookup, the write and the email all happen after the response has gone,
 * so neither the words nor the time taken say whether the address exists.
 * What it does say is whether this site can send email at all — that is
 * about the site, not the address.
 *
 * Asking about the same email is limited too, and a link younger than a
 * few minutes is left standing, so a stranger who knows the address can't
 * flood it with mail or keep killing the link its owner is about to click.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.length > 200) {
    return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  }

  const keys = [`forgot:${clientIp(req.headers) ?? "unknown"}`, `forgot:email:${email}`];
  const paused = await isThrottled(keys);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });
  await recordFailure([
    { key: keys[0], max: MAX_FORGOT_PER_IP },
    { key: keys[1], max: MAX_FORGOT_PER_EMAIL },
  ]);

  const configured = emailConfigured();
  const origin = siteOrigin(req.url);
  if (configured) {
    after(async () => {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, sessionVersion: true } });
      if (!user) return;
      const recent = await prisma.passwordReset.findFirst({
        where: { userId: user.id, usedAt: null, createdAt: { gt: new Date(Date.now() - FRESH_MS) } },
      });
      if (recent) return;
      const { token, tokenHash, expiresAt } = newResetToken();
      await prisma.$transaction([
        prisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } }),
        prisma.passwordReset.create({
          data: { userId: user.id, tokenHash, expiresAt, issuedBy: "self", sessionVersion: user.sessionVersion },
        }),
      ]);
      await sendEmail({ to: email, ...resetEmail(resetLink(origin, token)) });
    });
  }

  return NextResponse.json({ ok: true, emailConfigured: configured });
}
