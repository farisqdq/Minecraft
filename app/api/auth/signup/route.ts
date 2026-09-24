import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeJoinCode } from "@/lib/codes";
import { MAX_PER_IP, clientIp, ipKey, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";

/** Compare without leaking, through timing, how much of the code was right. */
function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const code = typeof body?.code === "string" ? body.code : "";

  // A live LLC join code also gets you through the signup gate, otherwise
  // gating signups would block the very people you handed a code to.
  const addressKey = ipKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  // Closed by default. A landlord account can create LLCs and upload files,
  // so a stranger who finds the URL shouldn't get one: you need either the
  // SIGNUP_CODE set in Vercel, or a live join code from someone's team. With
  // SIGNUP_CODE unset, only join codes work — the gate stays shut rather than
  // falling open because a setting was forgotten.
  const requiredCode = process.env.SIGNUP_CODE ?? "";
  const matchesSignupCode = requiredCode !== "" && sameSecret(code, requiredCode);
  if (!matchesSignupCode) {
    const token = normalizeJoinCode(code);
    const invite = token ? await prisma.invite.findUnique({ where: { token } }) : null;
    const validJoinCode = Boolean(invite && !invite.acceptedAt && invite.expiresAt > new Date());
    if (!validJoinCode) {
      await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
      return NextResponse.json(
        { error: requiredCode ? "Invalid signup code." : "You need a join code from an LLC's owner to sign up." },
        { status: 403 }
      );
    }
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (email.length > 200 || password.length > 200) {
    return NextResponse.json({ error: "That's too long." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, passwordHash, name: name || null },
  });

  return NextResponse.json({ ok: true });
}
