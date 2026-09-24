import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requireTenantSession } from "@/lib/tenant-access";
import { TRUST_DAYS, makeTrustToken, trustCookieName, type TrustKind } from "@/lib/device-trust";

/**
 * Remember this device for the account that just signed in on it.
 *
 * Called by the login pages straight after a successful sign-in. From then
 * on, someone else typing wrong passwords at this account can't lock it on
 * this device — see lib/device-trust.ts. The cookie is HttpOnly (page
 * scripts can't read it) and signed (it can't be made up or moved to
 * another account), and it stops working at the next "sign out everywhere".
 */
export async function POST() {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (!secret) return NextResponse.json({ ok: false }, { status: 503 });

  let kind: TrustKind;
  let email: string;
  let sessionVersion: number;

  const user = await getCurrentUser();
  if (user) {
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });
    if (!row) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    kind = "user";
    email = user.email;
    sessionVersion = row.sessionVersion;
  } else {
    const me = await requireTenantSession();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const row = await prisma.tenantAccount.findUnique({
      where: { id: me.accountId },
      select: { sessionVersion: true },
    });
    if (!row) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    kind = "tenant";
    email = me.email;
    sessionVersion = row.sessionVersion;
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(trustCookieName(kind), makeTrustToken({ secret, kind, email, sessionVersion }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TRUST_DAYS * 86_400,
  });
  return res;
}
