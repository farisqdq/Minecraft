import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { threadForTenant } from "@/lib/messages-db";
import { openRepairCount } from "@/lib/requests";
import { blobConfigured } from "@/lib/blob";
import ThreadClient from "./ThreadClient";

export const dynamic = "force-dynamic";

/**
 * One tenant's conversation. requireTenant is the gate: a tenant on another
 * LLC's books is a 404, the same as a made-up id.
 */
export default async function ThreadPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const { tenantId } = await params;
  const tenant = await requireTenant(me.id, tenantId);
  if (!tenant) notFound();

  const [thread, openRepairs] = await Promise.all([threadForTenant(tenantId, "landlord"), openRepairCount(me.id)]);
  if (!thread) notFound();

  return (
    <ThreadClient
      userLabel={me.name || me.email || "you"}
      serverNow={new Date().toISOString()}
      initial={thread}
      tenantActive={tenant.active}
      openRepairs={openRepairs}
      storageReady={blobConfigured()}
    />
  );
}
