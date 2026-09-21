import { NextResponse } from "next/server";
import { accountKey, clientIp, ipKey, isThrottled, type ThrottleKind } from "@/lib/throttle";

/**
 * Advisory only. The pause itself is enforced inside authorize(), where it
 * can't be skipped; this just lets the login page say "try again in 12
 * minutes" instead of "wrong password" to someone whose password is right.
 *
 * It reveals nothing an attacker didn't already cause: pauses exist only
 * because of failed attempts, and a row is written for an unknown email just
 * as for a real one, so the answer says nothing about whether an account
 * exists.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kind: ThrottleKind = body?.kind === "tenant" ? "tenant" : "user";
  const email = typeof body?.email === "string" ? body.email : "";
  if (!email) return NextResponse.json({ lockedForSeconds: 0 });

  const seconds = await isThrottled([accountKey(kind, email), ipKey(clientIp(req.headers))]);
  return NextResponse.json({ lockedForSeconds: seconds });
}
