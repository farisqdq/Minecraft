import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeJoinCode } from "@/lib/codes";
import { MAX_PER_IP, clientIp, ipKey, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { adminEmails } from "@/lib/admin";

/** Accounts one address can create inside the throttle window. */
const MAX_SIGNUPS_PER_IP = 10;
const signupIpKey = (ip: string | null) => (ip ? `signup:${ip}` : null);

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

  const addressKey = ipKey(clientIp(req.headers));
  const signupKey = signupIpKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey, signupKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  // Anyone can make an account and set up their own LLC — that's how a new
  // landlord gets started, and every account only ever sees its own
  // companies, so an open door exposes nobody else's books. The code box is
  // optional: a join code from an LLC's owner puts you straight onto that
  // team. An owner who wants the old invite-only door can set
  // SIGNUPS=invite-only, and then SIGNUP_CODE or a live join code is needed.
  const inviteOnly = process.env.SIGNUPS === "invite-only";
  const requiredCode = process.env.SIGNUP_CODE ?? "";
  const matchesSignupCode = requiredCode !== "" && code.trim() !== "" && sameSecret(code.trim(), requiredCode);

  const token = matchesSignupCode ? "" : normalizeJoinCode(code);
  const invite = token ? await prisma.invite.findUnique({ where: { token } }) : null;
  const validJoinCode = Boolean(invite && !invite.acceptedAt && invite.expiresAt > new Date());

  if (code.trim() && !matchesSignupCode && !validJoinCode) {
    await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return NextResponse.json(
      {
        error: inviteOnly
          ? "That code isn't valid — it may have been used already or expired."
          : "That join code isn't valid — it may have been used already or expired. Leave it blank to set up your own LLC.",
      },
      { status: 403 }
    );
  }
  if (inviteOnly && !matchesSignupCode && !validJoinCode) {
    await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return NextResponse.json(
      { error: "Signups here are by invitation. Ask an LLC's owner for a join code." },
      { status: 403 }
    );
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
  // The account and, with a join code, its place on that LLC's team go in
  // together. The code is claimed only while still unused and unexpired, so
  // two people redeeming it at once can't both get in.
  const result = await prisma.$transaction(async (tx) => {
    // The site's owner is an admin from the first sign-in, so the panel is
    // reachable even on a database where the migration found no account yet.
    const user = await tx.user.create({
      data: { email, passwordHash, name: name || null, isAdmin: adminEmails().has(email) },
    });
    if (!validJoinCode || !invite) return { joined: null as string | null };
    const claim = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claim.count !== 1) return { joined: null };
    await tx.companyMember.create({ data: { companyId: invite.companyId, userId: user.id, role: invite.role } });
    return { joined: invite.companyId };
  });

  // Every account made counts against the address, so an open signup form
  // can't be used to mint accounts by the thousand.
  await recordFailure([{ key: signupKey, max: MAX_SIGNUPS_PER_IP }]);

  return NextResponse.json({ ok: true, joinedCompanyId: result.joined });
}
