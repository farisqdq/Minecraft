import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { requireAdmin } from "@/lib/admin-db";
import { openRepairCount } from "@/lib/requests";
import { activityFor, activityPeople } from "@/lib/activity-db";
import type { ActorKind } from "@/lib/activity";
import ActivityClient from "./ActivityClient";

export const dynamic = "force-dynamic";

/**
 * The activity log (a34): everyone who has used the site, and for the one
 * picked, everything they did. Admins only — a 404 for anyone else, like
 * the rest of Admin.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; before?: string; changes?: string }>;
}) {
  if (!(await getCurrentUser())) redirect("/login");
  const admin = await requireAdmin();
  if (!admin) notFound();

  const { who, before, changes } = await searchParams;
  const m = /^(user|tenant|owner):(.+)$/.exec(who ?? "");
  const changesOnly = changes === "1";

  const [people, openRepairs, history] = await Promise.all([
    activityPeople(),
    openRepairCount(admin.id),
    m ? activityFor(m[1] as ActorKind, m[2], { before, changesOnly }) : Promise.resolve(null),
  ]);

  return (
    <ActivityClient
      openRepairs={openRepairs}
      people={people}
      selected={m ? `${m[1]}:${m[2]}` : null}
      history={history}
      changesOnly={changesOnly}
      paged={Boolean(before)}
    />
  );
}
