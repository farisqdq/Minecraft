import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { formatJoinCode, generateJoinCode } from "@/lib/codes";

const INVITE_DAYS = 7;

function present(invite: { id: string; role: string; token: string; expiresAt: Date }) {
  return {
    id: invite.id,
    role: invite.role,
    code: formatJoinCode(invite.token),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireCompany(userId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const invites = await prisma.invite.findMany({
    where: { companyId: id, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(invites.map(present));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner can create join codes." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const role = body?.role === "owner" ? "owner" : "member";
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);

  // Codes are unique; on the rare collision just draw another.
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateJoinCode();
    const clash = await prisma.invite.findUnique({ where: { token } });
    if (clash) continue;

    const invite = await prisma.invite.create({
      data: { companyId: id, role, token, invitedById: userId, expiresAt },
    });
    return NextResponse.json(present(invite), { status: 201 });
  }

  return NextResponse.json({ error: "Couldn't generate a code. Try again." }, { status: 500 });
}
