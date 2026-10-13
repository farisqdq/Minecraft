import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { openRepairCount } from "@/lib/requests";
import { notificationsFor } from "@/lib/notifications-db";
import NotificationsClient from "./NotificationsClient";

export const dynamic = "force-dynamic";

/** The notification center (a34): everything waiting on you, in one list. */
export default async function NotificationsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const [items, openRepairs] = await Promise.all([notificationsFor(me.id), openRepairCount(me.id)]);
  return (
    <NotificationsClient
      userLabel={me.name || me.email || "you"}
      serverNow={new Date().toISOString()}
      initial={items}
      openRepairs={openRepairs}
    />
  );
}
