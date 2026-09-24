import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { open } from "@/lib/sealed";
import { generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/lib/totp";
import { accountUser, bad, reauthPaused, unauthorized } from "@/lib/account";
import { MAX_PER_ACCOUNT, recordFailure } from "@/lib/throttle";

/**
 * Confirm the authenticator app works by entering one of its codes, which
 * turns two-factor on and hands back ten one-time backup codes. They are
 * shown once; only their hashes are kept.
 */
export async function POST(req: Request) {
  const user = await accountUser();
  if (!user) return unauthorized();
  if (user.totpSecret) return bad("Two-factor is already on.", 409);
  if (!user.totpPendingSecret) return bad("Start the setup first.");
  const paused = await reauthPaused(user.id);
  if (paused) return paused;

  const body = await req.json().catch(() => null);
  const secret = open(user.totpPendingSecret);
  const step = secret && typeof body?.code === "string" ? verifyTotp({ secret, code: body.code }) : null;
  if (step == null) {
    await recordFailure([{ key: `reauth:${user.id}`, max: MAX_PER_ACCOUNT }]);
    return bad("That code didn't match. Check the phone's clock is set automatically and try the next one.");
  }

  const codes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecret: user.totpPendingSecret,
      totpPendingSecret: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
      recoveryCodes: codes.map(hashRecoveryCode),
    },
  });
  return NextResponse.json({ ok: true, recoveryCodes: codes });
}
