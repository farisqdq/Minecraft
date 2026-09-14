import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InviteClient from "./InviteClient";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getServerSession(authOptions);

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { company: { select: { name: true } } },
  });

  const valid = Boolean(invite && !invite.acceptedAt && invite.expiresAt > new Date());

  return (
    <InviteClient
      token={token}
      valid={valid}
      companyName={valid ? invite!.company.name : ""}
      invitedEmail={valid ? invite!.email : ""}
      role={valid ? (invite!.role as "owner" | "member") : "member"}
      sessionEmail={session?.user?.email ?? null}
    />
  );
}
