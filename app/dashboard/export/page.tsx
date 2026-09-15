import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ExportClient from "./ExportClient";

export default async function ExportPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id as string;
  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const companies = memberships.map((m) => ({ id: m.company.id, name: m.company.name }));

  const earliest = await prisma.transaction.findFirst({
    where: { property: { companyId: { in: companies.map((c) => c.id) } } },
    orderBy: { date: "asc" },
    select: { date: true },
  });

  return <ExportClient companies={companies} earliestYear={earliest?.date.getFullYear() ?? null} />;
}
