import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { requireAdmin } from "@/lib/admin-db";
import { openRepairCount } from "@/lib/requests";
import { getSummary, phoneBackupConfigured } from "@/lib/phone-backup";
import GalleryClient from "./GalleryClient";

/** Photos and videos from the company phones — admin only. */
export default async function GalleryPage() {
  if (!(await getCurrentUser())) redirect("/login");
  const admin = await requireAdmin();
  if (!admin) notFound();
  const openRepairs = await openRepairCount(admin.id);

  let phones: { id: string; name: string }[] = [];
  let configured = phoneBackupConfigured();
  let down = false;
  if (configured) {
    try {
      const s = await getSummary();
      phones = (s.devices || []).filter((d: any) => d.paired).map((d: any) => ({ id: d.id, name: d.name }));
    } catch { down = true; /* server didn't answer; the page says so and retries */ }
  }
  return <GalleryClient openRepairs={openRepairs} configured={configured} phones={phones} down={down} />;
}
