import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BackupClient from "./BackupClient";

export default async function BackupPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id as string;
  const companyIds = (
    await prisma.companyMember.findMany({ where: { userId }, select: { companyId: true } })
  ).map((m) => m.companyId);

  const [companies, properties, units, recurring, transactions] = await Promise.all([
    companyIds.length,
    prisma.property.count({ where: { companyId: { in: companyIds } } }),
    prisma.unit.count({ where: { property: { companyId: { in: companyIds } } } }),
    prisma.recurringExpense.count({ where: { property: { companyId: { in: companyIds } } } }),
    prisma.transaction.count({ where: { property: { companyId: { in: companyIds } } } }),
  ]);

  return <BackupClient counts={{ companies, properties, units, recurring, transactions }} />;
}
