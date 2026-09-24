import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, isThrottled, type ThrottleKind } from "@/lib/throttle";
import { loginThrottleKeys } from "@/lib/login-rules";
import { cookieFrom, readTrustToken, trustCookieName } from "@/lib/device-trust";

/**
 * Advisory only. The pause itself is enforced inside authorize(), where it
 * can't be skipped; this just lets the login page say "try again in 12
 * minutes" instead of "wrong password" to someone whose password is right.
 *
 * It judges the attempt by exactly the counters authorize() would — so a
 * trusted device isn't told it's locked when only unknown devices are — and
 * reveals nothing an attacker didn't already cause: pauses exist only
 * because of failed attempts, and an unknown email is judged the same way as
 * a real one on an unknown device.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kind: ThrottleKind = body?.kind === "tenant" ? "tenant" : "user";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  if (!email) return NextResponse.json({ lockedForSeconds: 0 });

  const account =
    kind === "user"
      ? await prisma.user.findUnique({ where: { email }, select: { sessionVersion: true } })
      : await prisma.tenantAccount.findUnique({ where: { email }, select: { sessionVersion: true } });
  const trustedSince = account
    ? readTrustToken({
        secret: process.env.NEXTAUTH_SECRET ?? "",
        token: cookieFrom(req.headers.get("cookie"), trustCookieName(kind)),
        kind,
        email,
        sessionVersion: account.sessionVersion,
      })
    : null;

  const keys = loginThrottleKeys({ kind, email, ip: clientIp(req.headers), trustedSince });
  const seconds = await isThrottled(keys.map((k) => k.key));
  return NextResponse.json({ lockedForSeconds: seconds });
}
