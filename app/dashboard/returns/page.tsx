import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { openRepairCount } from "@/lib/requests";
import { isoDay } from "@/lib/lease";
import { applyDueRentChanges } from "@/lib/renewals-db";
import { computeReturns } from "@/lib/returns";
import { returnsDataFor } from "@/lib/returns-db";
import ReturnsClient from "./ReturnsClient";

/**
 * Every property as an investment, side by side (a31). The arithmetic runs
 * here, once, so the page carries a row of figures per property rather than
 * every ledger entry the portfolio has ever had.
 */
export default async function ReturnsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const memberships = await prisma.companyMember.findMany({
    where: { userId: me.id },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const companyIds = memberships.map((m) => m.companyId);
  await applyDueRentChanges({ property: { companyId: { in: companyIds } } });

  const where = { companyId: { in: companyIds } };
  const [properties, data, openRepairs] = await Promise.all([
    prisma.property.findMany({
      where,
      select: { id: true, name: true, address: true, companyId: true },
      orderBy: { createdAt: "asc" },
    }),
    returnsDataFor(where),
    openRepairCount(me.id),
  ]);

  const today = isoDay(new Date());
  return (
    <ReturnsClient
      openRepairs={openRepairs}
      userLabel={me.name || me.email || "you"}
      companies={memberships.map((m) => m.company)}
      rows={properties.flatMap((p) => {
        const d = data.get(p.id);
        if (!d) return [];
        return [
          {
            id: p.id,
            name: p.name,
            address: p.address ?? "",
            companyId: p.companyId,
            purchasePrice: d.purchasePrice,
            purchasedOn: d.purchasedOn,
            cashInvested: d.cashInvested,
            returns: computeReturns({ ...d, today }),
          },
        ];
      })}
    />
  );
}
