import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { appearanceFrom } from "@/lib/appearance";
import { ShellProvider } from "../components/ShellContext";
import { AppearanceProvider } from "../components/appearance/AppearanceContext";

/**
 * Tells the shell whether the person is a site admin, so the Admin tab can
 * appear for them and nobody else, and which layout, mode and accent they
 * chose on Settings > Appearance. The user lookup is cached per request, so
 * pages that ask again don't pay for it twice.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getCurrentUser();
  const prefs = me
    ? await prisma.user.findUnique({ where: { id: me.id }, select: { uiLayout: true, uiTheme: true, uiAccent: true } })
    : null;
  return (
    <ShellProvider admin={Boolean(me?.isAdmin)}>
      <AppearanceProvider initial={appearanceFrom(prefs)} endpoint="/api/account/appearance">
        {children}
      </AppearanceProvider>
    </ShellProvider>
  );
}
