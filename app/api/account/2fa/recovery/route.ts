import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/totp";
import { accountUser, bad, checkCode, reauthPaused, unauthorized } from "@/lib/account";

/** A fresh set of backup codes; the old ones stop working. Needs a current code. */
export async function POST(req: Request) {
  const user = await accountUser();
  if (!user) return unauthorized();
  if (!user.totpSecret) return bad("Two-factor isn't on.", 409);
  const paused = await reauthPaused(user.id);
  if (paused) return paused;

  const body = await req.json().catch(() => null);
  if (!(await checkCode(user, body?.code))) return bad("That code didn't work.", 403);

  const codes = generateRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { recoveryCodes: codes.map(hashRecoveryCode) } });
  return NextResponse.json({ ok: true, recoveryCodes: codes });
}
