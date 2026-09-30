import { cache } from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_APPEARANCE, appearanceFrom, portalAppearance, type Appearance } from "@/lib/appearance";

/**
 * Whoever is signed in — landlord, tenant or owner — and their saved
 * appearance, read once per request. The root layout puts it on <html>
 * before the first paint (no flash of the wrong theme) and the dashboard and
 * portal layouts hand the same value to the client. Nobody signed in gets
 * the defaults.
 *
 * This only decides colours, so it skips the sessionVersion check the access
 * helpers do: a stale token here can at worst paint a page in its former
 * owner's chosen mode, and the page's own access check still turns them away.
 */
export const getRequestAppearance = cache(async (): Promise<Appearance> => {
  try {
    const session = await getServerSession(authOptions);
    const id = session?.user?.id;
    if (!session || !id) return DEFAULT_APPEARANCE;
    if (session.kind === "tenant") {
      return portalAppearance(await prisma.tenantAccount.findUnique({ where: { id }, select: { uiTheme: true } }));
    }
    if (session.kind === "owner") {
      return portalAppearance(await prisma.propertyOwner.findUnique({ where: { id }, select: { uiTheme: true } }));
    }
    return appearanceFrom(
      await prisma.user.findUnique({ where: { id }, select: { uiLayout: true, uiTheme: true, uiAccent: true } })
    );
  } catch {
    // A database hiccup must never take a page down over colours.
    return DEFAULT_APPEARANCE;
  }
});
