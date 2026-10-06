import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_APPEARANCE } from "@/lib/appearance";
import { getRequestAppearance } from "@/lib/appearance-server";
import { ShellProvider } from "../components/ShellContext";
import { AppearanceProvider } from "../components/appearance/AppearanceContext";

/**
 * Tells the shell whether the person is a site admin, so the Admin tab can
 * appear for them and nobody else, and which layout, mode and accent they
 * chose on Settings > Appearance. Both lookups are cached per request (the
 * root layout already read the appearance to put it on <html>), so this
 * costs no extra queries.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getCurrentUser();
  const appearance = me ? await getRequestAppearance() : DEFAULT_APPEARANCE;
  return (
    <ShellProvider admin={Boolean(me?.isAdmin)}>
      <AppearanceProvider initial={appearance} endpoint="/api/account/appearance">
        {children}
      </AppearanceProvider>
    </ShellProvider>
  );
}
