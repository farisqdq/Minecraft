import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import BackupClient from "./BackupClient";

export default async function BackupPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const companyIds = (
    await prisma.companyMember.findMany({ where: { userId }, select: { companyId: true } })
  ).map((m) => m.companyId);

  const [companies, properties, units, recurring, transactions, tenants] = await Promise.all([
    companyIds.length,
    prisma.property.count({ where: { companyId: { in: companyIds } } }),
    prisma.unit.count({ where: { property: { companyId: { in: companyIds } } } }),
    prisma.recurringExpense.count({ where: { property: { companyId: { in: companyIds } } } }),
    prisma.transaction.count({ where: { property: { companyId: { in: companyIds } } } }),
    prisma.tenant.count({ where: { property: { companyId: { in: companyIds } } } }),
  ]);

  return (
    <BackupClient counts={{ companies, properties, units, recurring, transactions, tenants }} />
  );
}
