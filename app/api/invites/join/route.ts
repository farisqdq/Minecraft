import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { normalizeJoinCode } from "@/lib/codes";
import {
  MAX_PER_ACCOUNT,
  MAX_PER_IP,
  clientIp,
  ipKey,
  isThrottled,
  pauseMessage,
  recordFailure,
} from "@/lib/throttle";

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A code is a key to an LLC, so wrong guesses are counted like wrong
  // passwords — per account and per address — or a signed-in user could
  // simply try codes until one opened someone else's books.
  const keys = [`join:${userId}`, ipKey(clientIp(req.headers))];
  const paused = await isThrottled(keys);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  const body = await req.json().catch(() => null);
  const code = normalizeJoinCode(typeof body?.code === "string" ? body.code : "");
  if (!code) return NextResponse.json({ error: "Enter a join code." }, { status: 400 });

  const miss = async () => {
    await recordFailure([
      { key: keys[0], max: MAX_PER_ACCOUNT },
      { key: keys[1], max: MAX_PER_IP },
    ]);
    return NextResponse.json(
      { error: "That code isn't valid — it may have been used already or expired." },
      { status: 404 }
    );
  };

  const invite = await prisma.invite.findUnique({
    where: { token: code },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return miss();

  const existing = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: invite.companyId, userId } },
  });
  if (existing) {
    return NextResponse.json({ error: `You're already on ${invite.company.name}.` }, { status: 409 });
  }

  // Claim the code and join in one step. The claim only succeeds while the
  // code is still unused and unexpired, so two people redeeming the same code
  // at the same moment can't both get in: the second update matches nothing.
  const joined = await prisma.$transaction(async (tx) => {
    const claim = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claim.count !== 1) return false;
    await tx.companyMember.create({
      data: { companyId: invite.companyId, userId, role: invite.role },
    });
    return true;
  });
  if (!joined) return miss();

  return NextResponse.json({ ok: true, companyId: invite.companyId, companyName: invite.company.name });
}
