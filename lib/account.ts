import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { MAX_PER_ACCOUNT, isThrottled, pauseMessage, recordFailure, clearFailures } from "@/lib/throttle";
import { open } from "@/lib/sealed";
import { verifyTotp } from "@/lib/totp";

/**
 * Shared checks for the account settings routes. Anything that could lock
 * the real owner out — changing the password, turning two-factor on or off —
 * asks for the password again, so a session left open on someone else's
 * screen can't be used to take the account over. Wrong answers are counted
 * like wrong logins.
 */

export async function accountUser() {
  const me = await getCurrentUser();
  if (!me) return null;
  return prisma.user.findUnique({ where: { id: me.id } });
}

export type AccountUser = NonNullable<Awaited<ReturnType<typeof accountUser>>>;

const reauthKey = (userId: string) => `reauth:${userId}`;

/** A 429 to send back, or null when the account may try. */
export async function reauthPaused(userId: string) {
  const paused = await isThrottled([reauthKey(userId)]);
  return paused ? NextResponse.json({ error: pauseMessage(paused) }, { status: 429 }) : null;
}

export async function checkPassword(user: AccountUser, password: unknown): Promise<boolean> {
  const ok = typeof password === "string" && password.length <= 200 && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) await recordFailure([{ key: reauthKey(user.id), max: MAX_PER_ACCOUNT }]);
  else await clearFailures(reauthKey(user.id));
  return ok;
}

/**
 * A current authenticator code for this account, spent as it's accepted so
 * the same code can't be replayed.
 */
export async function checkCode(user: AccountUser, code: unknown): Promise<boolean> {
  if (typeof code !== "string" || !user.totpSecret) return false;
  const secret = open(user.totpSecret);
  const step = secret ? verifyTotp({ secret, code, lastStep: user.totpLastStep }) : null;
  if (step == null) {
    await recordFailure([{ key: reauthKey(user.id), max: MAX_PER_ACCOUNT }]);
    return false;
  }
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return claimed.count === 1;
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
