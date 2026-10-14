import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { requireAdmin } from "@/lib/admin-db";
import { openRepairCount } from "@/lib/requests";
import { getSummary, phoneBackupConfigured, phoneBackupHost, isBackupDown } from "@/lib/phone-backup";
import PhonesClient from "./PhonesClient";

/**
 * The company phones and their backups — admin only, so a 404 for anyone
 * else, exactly like the Admin page. The first load fetches the VPS server's
 * summary on the server side so the page arrives filled in; the client
 * refreshes from there.
 */
export default async function PhonesPage() {
  if (!(await getCurrentUser())) redirect("/login");
  const admin = await requireAdmin();
  if (!admin) notFound();
  const openRepairs = await openRepairCount(admin.id);

  let initial: any = { configured: phoneBackupConfigured(), host: phoneBackupHost() };
  if (phoneBackupConfigured()) {
    try {
      initial = { configured: true, host: phoneBackupHost(), ...(await getSummary()) };
    } catch (e) {
      initial = { configured: true, host: phoneBackupHost(), down: isBackupDown(e), error: (e as Error).message };
    }
  }
  return <PhonesClient openRepairs={openRepairs} initial={initial} />;
}
