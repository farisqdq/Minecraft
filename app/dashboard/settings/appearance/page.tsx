import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { openRepairCount } from "@/lib/requests";
import AppearanceClient from "./AppearanceClient";

export const metadata: Metadata = { title: "Appearance · Rent Roll" };

/**
 * Settings > Appearance: each person's own layout, mode and accent. The
 * choice itself comes from the dashboard layout's AppearanceProvider (already
 * read for <html>), so this page only needs what the shell shows.
 */
export default async function AppearancePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const openRepairs = await openRepairCount(me.id);
  return <AppearanceClient openRepairs={openRepairs} userLabel={me.name || me.email} />;
}
