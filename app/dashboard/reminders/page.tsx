import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { openRepairCount } from "@/lib/requests";
import { reminderSnapshot } from "@/lib/reminders-db";
import RemindersClient from "./RemindersClient";

/** Automatic reminders, per LLC, and notifications on this device. */
export default async function RemindersPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const [memberships, openRepairs] = await Promise.all([
    prisma.companyMember.findMany({
      where: { userId: me.id },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    openRepairCount(me.id),
  ]);
  const companies = [];
  for (const m of memberships) {
    companies.push({
      id: m.company.id,
      name: m.company.name,
      role: m.role === "owner" ? ("owner" as const) : ("member" as const),
      snapshot: await reminderSnapshot(m.company.id),
    });
  }

  return <RemindersClient userLabel={me.name || me.email || "you"} openRepairs={openRepairs} companies={companies} />;
}
