import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { adminSnapshot, requireAdmin } from "@/lib/admin-db";
import { openRepairCount } from "@/lib/requests";
import AdminClient from "./AdminClient";

/** The site's accounts and LLCs. A 404 for anyone who isn't an admin — the same as any page that doesn't exist for them. */
export default async function AdminPage() {
  if (!(await getCurrentUser())) redirect("/login");
  const admin = await requireAdmin();
  if (!admin) notFound();
  const [snapshot, openRepairs] = await Promise.all([adminSnapshot(), openRepairCount(admin.id)]);
  return <AdminClient openRepairs={openRepairs} me={{ id: admin.id, email: admin.email }} initial={snapshot} />;
}
