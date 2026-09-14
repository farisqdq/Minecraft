import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";

const INVITE_DAYS = 7;

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

  return NextResponse.json(
    invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      token: i.token,
      expiresAt: i.expiresAt.toISOString(),
    }))
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner can invite teammates." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role === "owner" ? "owner" : "member";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const alreadyMember = await prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId: id, userId: existingUser.id } },
    });
    if (alreadyMember) {
      return NextResponse.json({ error: "They're already on this team." }, { status: 409 });
    }
  }

  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const token = randomBytes(24).toString("base64url");

  // Replace any outstanding invite for the same address rather than stacking them.
  await prisma.invite.deleteMany({ where: { companyId: id, email, acceptedAt: null } });

  const invite = await prisma.invite.create({
    data: { companyId: id, email, role, token, invitedById: userId, expiresAt },
  });

  return NextResponse.json(
    {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
    },
    { status: 201 }
  );
}
