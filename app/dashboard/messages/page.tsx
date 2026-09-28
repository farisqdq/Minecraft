import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { companyIdsForUser } from "@/lib/access";
import { inboxFor } from "@/lib/messages-db";
import { openRepairCount } from "@/lib/requests";
import InboxClient from "./InboxClient";

export const dynamic = "force-dynamic";

/** Every conversation across the landlord's LLCs, newest activity first. */
export default async function MessagesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const companyIds = await companyIdsForUser(me.id);
  const [rows, openRepairs, tenants] = await Promise.all([
    inboxFor(me.id),
    openRepairCount(me.id),
    // Who a new conversation could be with: current tenants only. A past
    // tenant's thread is still in the list if there ever was one.
    prisma.tenant.findMany({
      where: { active: true, property: { companyId: { in: companyIds } } },
      orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        property: { select: { name: true } },
        unit: { select: { name: true } },
        account: { select: { id: true } },
      },
    }),
  ]);

  return (
    <InboxClient
      userLabel={me.name || me.email || "you"}
      serverNow={new Date().toISOString()}
      initial={rows}
      openRepairs={openRepairs}
      tenants={tenants.map((t) => ({
        id: t.id,
        name: t.name,
        place: [t.property.name, t.unit?.name].filter(Boolean).join(" — "),
        hasPortal: Boolean(t.account),
      }))}
    />
  );
}
