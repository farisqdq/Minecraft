import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * The signed-in landlord or team member, or null.
 *
 * This is the front door to every company-scoped query in the app, so it
 * fails closed: anything that is not explicitly a "user" session — a tenant's
 * portal login, a token from some future third kind, a token with the field
 * missing — comes back null. A tenant reaching a landlord route gets exactly
 * what a stranger gets.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (session?.kind !== "user") return null;
  return session.user?.id ?? null;
}

/**
 * The same session as above, with the name and email the header prints.
 * Shares the one kind check so a caller that needs the label can't reach for
 * getServerSession and skip it.
 */
export async function getCurrentUser(): Promise<{ id: string; name: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  if (session?.kind !== "user" || !session.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
  };
}

/**
 * The signed-in tenant's TenantAccount id, or null. The mirror image of the
 * above, and just as strict: a landlord's session is not a tenant session.
 *
 * It returns the account id rather than the tenant id on purpose — the tenant
 * row is looked up fresh on every request (see requireTenantSession), so a
 * tenant marked moved-out or deleted loses the portal on their next click
 * rather than whenever their token happens to expire.
 */
export async function getCurrentTenantAccountId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (session?.kind !== "tenant") return null;
  return session.user?.id ?? null;
}
