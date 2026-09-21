import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { normalizeJoinCode } from "@/lib/codes";
import { MAX_PER_IP, clientIp, ipKey, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code : "";

  // A live LLC join code also gets you through the signup gate, otherwise
  // gating signups would block the very people you handed a code to.
  const addressKey = ipKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  const requiredCode = process.env.SIGNUP_CODE;
  if (requiredCode && code !== requiredCode) {
    const invite = await prisma.invite.findUnique({
      where: { token: normalizeJoinCode(code) },
    });
    const validJoinCode = Boolean(invite && !invite.acceptedAt && invite.expiresAt > new Date());
    if (!validJoinCode) {
      await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
      return NextResponse.json({ error: "Invalid signup code." }, { status: 403 });
    }
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
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
