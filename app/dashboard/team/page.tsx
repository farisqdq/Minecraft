import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TeamClient from "./TeamClient";

export default async function TeamPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id as string;

  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    include: {
      company: {
        include: {
          members: {
            include: { user: { select: { id: true, email: true, name: true } } },
            orderBy: { createdAt: "asc" },
          },
          invites: {
            where: { acceptedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <TeamClient
      currentUserId={userId}
      companies={memberships.map((m) => ({
        id: m.company.id,
        name: m.company.name,
        role: m.role as "owner" | "member",
        members: m.company.members.map((x) => ({
          userId: x.user.id,
          email: x.user.email,
          name: x.user.name ?? "",
          role: x.role as "owner" | "member",
        })),
        invites: m.company.invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role as "owner" | "member",
          token: i.token,
          expiresAt: i.expiresAt.toISOString(),
        })),
      }))}
    />
  );
}
