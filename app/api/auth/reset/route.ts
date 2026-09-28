import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { MAX_PER_IP, accountKey, clearFailures, clientIp, ipKey, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { hashToken, passwordProblem, plausibleToken, resetIsLive } from "@/lib/password-reset";

/**
 * Sets a new password from a reset link. The token works once, then the
 * account is signed out everywhere — the usual reason for a reset is not
 * being sure who has the old password. Two-factor is untouched.
 */
export async function POST(req: Request) {
  const addressKey = ipKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  const body = await req.json().catch(() => null);
  const token = body?.token;
  const password = body?.password;
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const expired = NextResponse.json(
    { error: "That link has expired or was already used. Ask for a new one." },
    { status: 400 }
  );
  if (!plausibleToken(token)) {
    await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return expired;
  }
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!reset || !resetIsLive(reset)) {
    await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return expired;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // Claim the token and change the password together: the claim only
  // succeeds while the token is unused, so two submissions of the same link
  // can't both go through.
  const done = await prisma.$transaction(async (tx) => {
    const claim = await tx.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count !== 1) return false;
    await tx.user.update({
      where: { id: reset.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.passwordReset.deleteMany({ where: { userId: reset.userId, id: { not: reset.id } } });
    return true;
  });
  if (!done) return expired;

  // A right password by another route: the account's wrong-guess count no
  // longer says anything about the person now holding it.
  await clearFailures(accountKey("user", reset.user.email));
  return NextResponse.json({ ok: true });
}
