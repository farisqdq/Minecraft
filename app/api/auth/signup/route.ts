import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const inviteToken = typeof body?.inviteToken === "string" ? body.inviteToken : "";

  // A live invite addressed to this person stands in for the signup code,
  // otherwise gating signups would also block the people you invited.
  let invited = false;
  if (inviteToken) {
    const invite = await prisma.invite.findUnique({ where: { token: inviteToken } });
    invited = Boolean(
      invite && !invite.acceptedAt && invite.expiresAt > new Date() && invite.email === email
    );
  }

  const requiredCode = process.env.SIGNUP_CODE;
  if (requiredCode && !invited && code !== requiredCode) {
    return NextResponse.json({ error: "Invalid signup code." }, { status: 403 });
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
