import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatJoinCode } from "@/lib/codes";
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

  // What a delete would take with it, so the confirmation can be specific.
  const properties = await prisma.property.findMany({
    where: { companyId: { in: memberships.map((m) => m.companyId) } },
    select: { companyId: true, _count: { select: { transactions: true } } },
  });
  const impact = new Map<string, { properties: number; transactions: number }>();
  for (const p of properties) {
    const entry = impact.get(p.companyId) ?? { properties: 0, transactions: 0 };
    entry.properties += 1;
    entry.transactions += p._count.transactions;
    impact.set(p.companyId, entry);
  }

  return (
    <TeamClient
      currentUserId={userId}
      companies={memberships.map((m) => ({
        id: m.company.id,
        name: m.company.name,
        role: m.role as "owner" | "member",
        propertyCount: impact.get(m.companyId)?.properties ?? 0,
        transactionCount: impact.get(m.companyId)?.transactions ?? 0,
        members: m.company.members.map((x) => ({
          userId: x.user.id,
          email: x.user.email,
          name: x.user.name ?? "",
          role: x.role as "owner" | "member",
        })),
        invites: m.company.invites.map((i) => ({
          id: i.id,
          role: i.role as "owner" | "member",
          code: formatJoinCode(i.token),
          expiresAt: i.expiresAt.toISOString(),
        })),
      }))}
    />
  );
}
