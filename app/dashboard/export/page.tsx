import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import ExportClient from "./ExportClient";

export default async function ExportPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
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
