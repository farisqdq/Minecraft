import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { openRepairCount } from "@/lib/requests";
import SettingsClient from "./SettingsClient";

export const metadata: Metadata = { title: "Settings · Rent Roll" };

/** Settings: one place that points to every per-person and per-LLC setting. */
export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const openRepairs = await openRepairCount(me.id);
  return <SettingsClient openRepairs={openRepairs} userLabel={me.name || me.email} admin={me.isAdmin} />;
}
