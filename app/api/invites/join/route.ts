import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { normalizeJoinCode } from "@/lib/codes";

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const code = normalizeJoinCode(typeof body?.code === "string" ? body.code : "");
  if (!code) return NextResponse.json({ error: "Enter a join code." }, { status: 400 });

  const invite = await prisma.invite.findUnique({
    where: { token: code },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "That code isn't valid — it may have been used already or expired." },
      { status: 404 }
    );
  }

  const existing = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: invite.companyId, userId } },
  });
  if (existing) {
    return NextResponse.json({ error: `You're already on ${invite.company.name}.` }, { status: 409 });
  }

  await prisma.companyMember.create({
    data: { companyId: invite.companyId, userId, role: invite.role },
  });
  // Single use: each person gets their own code.
  await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

  return NextResponse.json({ ok: true, companyId: invite.companyId, companyName: invite.company.name });
}
