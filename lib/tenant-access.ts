import { prisma } from "@/lib/prisma";
import { getCurrentTenantAccountId } from "@/lib/session";

/**
 * Everything a portal page is allowed to know, resolved from the session on
 * every request: who is signed in, which place they rent, and who to call.
 *
 * Nothing here is taken from the URL. A tenant route never accepts an id for
 * the thing it is about — the session decides, so there is no id to tamper
 * with. That is the whole isolation story for the portal: one query, scoped
 * by a session field the tenant cannot set.
 */
export type TenantSession = NonNullable<Awaited<ReturnType<typeof requireTenantSession>>>;

export async function requireTenantSession() {
  const accountId = await getCurrentTenantAccountId();
  if (!accountId) return null;

  const account = await prisma.tenantAccount.findUnique({
    where: { id: accountId },
    include: {
      tenant: {
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              company: { select: { name: true, contactPhone: true, contactEmail: true } },
            },
          },
          unit: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!account) return null;

  // Re-checked here rather than only at login: a tenant marked moved out
  // mid-session is out on their next click, not whenever the token expires.
  if (!account.tenant.active) return null;

  return {
    accountId: account.id,
    email: account.email,
    tenant: account.tenant,
    property: account.tenant.property,
    unit: account.tenant.unit,
  };
}
