import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accountUser, bad, checkCode, checkPassword, reauthPaused, unauthorized } from "@/lib/account";

/** Turn two-factor off. Needs the password and a current code, both. */
export async function POST(req: Request) {
  const user = await accountUser();
  if (!user) return unauthorized();
  if (!user.totpSecret) return bad("Two-factor isn't on.", 409);
  const paused = await reauthPaused(user.id);
  if (paused) return paused;

  const body = await req.json().catch(() => null);
  if (!(await checkPassword(user, body?.password))) return bad("That password isn't right.", 403);
  if (!(await checkCode(user, body?.code))) return bad("That code didn't work.", 403);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecret: null,
      totpPendingSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodes: [],
    },
  });
  return NextResponse.json({ ok: true });
}
