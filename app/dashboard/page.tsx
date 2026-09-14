import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  const userId = session.user.id as string;

  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);

  const [properties, transactions] = await Promise.all([
    prisma.property.findMany({
      where: { companyId: { in: companyIds } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transaction.findMany({
      where: { property: { companyId: { in: companyIds } } },
      orderBy: { date: "desc" },
      include: { attachments: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  return (
    <DashboardClient
      userLabel={session.user.name || session.user.email || "you"}
      initialCompanies={memberships.map((m) => ({
        id: m.company.id,
        name: m.company.name,
        role: m.role as "owner" | "member",
      }))}
      initialProperties={properties.map((p) => ({
        id: p.id,
        companyId: p.companyId,
        name: p.name,
        address: p.address ?? "",
        monthlyRent: p.monthlyRent,
      }))}
      initialTransactions={transactions.map((t) => ({
        id: t.id,
        propertyId: t.propertyId,
        type: t.type as "rent" | "expense",
        date: t.date.toISOString().slice(0, 10),
        amount: t.amount,
        detail: t.detail ?? "",
        note: t.note ?? "",
        attachments: t.attachments.map((a) => ({
          id: a.id,
          transactionId: a.transactionId,
          url: a.url,
          filename: a.filename,
          contentType: a.contentType,
        })),
      }))}
    />
  );
}
