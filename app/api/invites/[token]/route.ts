import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

async function loadInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

/** Preview an invite — intentionally readable while signed out, so the
 *  landing page can name the LLC before asking someone to sign in. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await loadInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "This invite has expired or already been used." }, { status: 404 });
  }

  return NextResponse.json({
    companyName: invite.company.name,
    email: invite.email,
    role: invite.role,
  });
}

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const sessionEmail = session?.user?.email?.toLowerCase();
  if (!userId || !sessionEmail) {
    return NextResponse.json({ error: "Sign in to accept this invite." }, { status: 401 });
  }

  const { token } = await params;
  const invite = await loadInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "This invite has expired or already been used." }, { status: 404 });
  }

  if (invite.email !== sessionEmail) {
    return NextResponse.json(
      {
        error: `This invite was sent to ${invite.email}, but you're signed in as ${sessionEmail}.`,
      },
      { status: 403 }
    );
  }

  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: invite.companyId, userId } },
    create: { companyId: invite.companyId, userId, role: invite.role },
    update: {},
  });
  await prisma.invite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });

  return NextResponse.json({ ok: true, companyId: invite.companyId, companyName: invite.company.name });
}
