import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { emailConfigured } from "@/lib/email";
import { siteOrigin } from "@/lib/site";
import { issueOwnerReset } from "@/lib/owner-reset-db";

const MAX_FORGOT_PER_IP = 10;
const MAX_FORGOT_PER_EMAIL = 3;

/**
 * "I forgot my owner-portal password." The landlord version's rules: the
 * same answer whether or not the address has an owner login, given before
 * anything is looked up (the lookup and the email happen after the response
 * has gone, so neither the words nor the timing tell), asks limited per
 * address and per email, and a link younger than five minutes left alone.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.length > 200) {
    return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  }

  const keys = [`owner-forgot:${clientIp(req.headers) ?? "unknown"}`, `owner-forgot:email:${email}`];
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
      const owner = await prisma.propertyOwner.findUnique({
        where: { email },
        select: { id: true, email: true, sessionVersion: true, access: { select: { id: true }, take: 1 } },
      });
      // No login, or no property left to see: nothing to reset into.
      if (!owner || owner.access.length === 0) return;
      await issueOwnerReset({ owner, issuedBy: "self", origin, respectFresh: true });
    });
  }
  return NextResponse.json({ ok: true, emailConfigured: configured });
}
