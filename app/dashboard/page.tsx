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

  const [properties, transactions] = await Promise.all([
    prisma.property.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.transaction.findMany({ where: { userId }, orderBy: { date: "desc" } }),
  ]);

  return (
    <DashboardClient
      userLabel={session.user.name || session.user.email || "you"}
      initialProperties={properties.map((p) => ({
        id: p.id,
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
      }))}
    />
  );
}
