import { cache } from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * The signed-in landlord's id, or null.
 *
 * This is the front door to every company-scoped query in the app, so it
 * fails closed: anything that is not explicitly a "user" session — a tenant's
 * portal login, a token from some future third kind, a token with the field
 * missing — comes back null. A tenant reaching a landlord route gets exactly
 * what a stranger gets.
 *
 * A session token alone is not enough: it is also checked against the
 * account's sessionVersion, so "sign out everywhere" and a password change
 * end every session on its next request instead of whenever the token
 * expires. Cached per request, so a page that asks five times costs one
 * query.
 */
const currentUser = cache(async () => {
  const session = await getServerSession(authOptions);
  if (session?.kind !== "user" || !session.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, sessionVersion: true },
  });
  // Deleted, or signed out everywhere since this token was issued.
  if (!user || user.sessionVersion !== (session.sv ?? 0)) return null;
  return { id: user.id, name: user.name ?? "", email: user.email };
});

export async function getCurrentUserId(): Promise<string | null> {
  return (await currentUser())?.id ?? null;
}

export async function getCurrentUser(): Promise<{ id: string; name: string; email: string } | null> {
  return currentUser();
}

/**
 * The tenant account's id from the session, if the session is a tenant's.
 * requireTenantSession (lib/tenant-access) does the database checks —
 * account still exists, still active, sessionVersion unchanged.
 */
export async function getCurrentTenantSession(): Promise<{ accountId: string; sv: number } | null> {
  const session = await getServerSession(authOptions);
  if (session?.kind !== "tenant" || !session.user?.id) return null;
  return { accountId: session.user.id, sv: session.sv ?? 0 };
}

export async function getCurrentTenantAccountId(): Promise<string | null> {
  return (await getCurrentTenantSession())?.accountId ?? null;
}
