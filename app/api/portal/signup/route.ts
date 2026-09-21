import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { normalizeJoinCode } from "@/lib/codes";
import { emailProblem, passwordProblem } from "@/lib/portal";
import { MAX_PER_IP, clientIp, ipKey, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";

/**
 * Redeem a landlord-issued code into a tenant login.
 *
 * Public by necessity — the person using it has no session yet — so the code
 * is the whole gate. It names one tenant, it is single use, and it expires.
 * Nothing in the request body says which property or unit the new account can
 * see; that comes from the invite's tenantId and nowhere else.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const code = normalizeJoinCode(typeof body?.code === "string" ? body.code : "");
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!code) return NextResponse.json({ error: "Enter the code your landlord gave you." }, { status: 400 });

  const emailError = emailProblem(email);
  if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });

  const passwordError = passwordProblem(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const addressKey = ipKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  const invite = await prisma.tenantInvite.findUnique({
    where: { code },
    include: { tenant: { select: { id: true, name: true, active: true } } },
  });
  // One message for every way a code can fail, so this can't be used to probe
  // which codes exist — and each miss counts against the address.
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date() || !invite.tenant.active) {
    await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return NextResponse.json(
      { error: "That code isn't valid — it may have been used already or expired. Ask your landlord for a new one." },
      { status: 404 }
    );
  }

  const [takenByTenant, takenByEmail] = await Promise.all([
    prisma.tenantAccount.findUnique({ where: { tenantId: invite.tenantId } }),
    prisma.tenantAccount.findUnique({ where: { email } }),
  ]);
  if (takenByTenant) {
    return NextResponse.json({ error: "That code has already been set up. Sign in instead." }, { status: 409 });
  }
  if (takenByEmail) {
    return NextResponse.json({ error: "There's already an account with that email." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.tenantAccount.create({ data: { tenantId: invite.tenantId, email, passwordHash } }),
    prisma.tenantInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);

  return NextResponse.json({ ok: true, name: invite.tenant.name });
}
