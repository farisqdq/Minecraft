import { NextResponse, type NextFetchEvent } from "next/server";
import withAuth, { type NextRequestWithAuth } from "next-auth/middleware";
import { crossSiteMutation } from "./lib/origin";

/** Everything a tenant is allowed to reach once signed in. */
const TENANT_AREA = ["/portal", "/api/portal"];

/**
 * Reachable without a session: signing in, signing up, and redeeming a
 * tenant's portal code. They are in the matcher only so the cross-site check
 * below covers them too — a forged signup or login is still a forgery.
 */
const PUBLIC = ["/api/auth", "/api/portal/signup"];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * The outer wall. Route handlers check again with getCurrentUserId or
 * requireTenantSession — this is not the only lock — but it means a tenant
 * token never even reaches the landlord code, and vice versa.
 *
 * /portal/login and /portal/signup are deliberately outside the matcher
 * below: you have to be able to get to them without a session.
 */
/**
 * Session rules. Run second: NextAuth's wrapper returns early for anything
 * under /api/auth — which includes this app's own signup route — so a check
 * placed inside it would never see those requests.
 */
const withSession = withAuth(
  function sessionOk() {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ req, token }) {
        const path = req.nextUrl.pathname;
        if (PUBLIC.some((base) => under(path, base))) return true;
        if (!token) return false;
        const tenant = token.kind === "tenant";
        const inTenantArea = TENANT_AREA.some((base) => under(path, base));
        return inTenantArea ? tenant : !tenant;
      },
    },
  }
);

/**
 * Anything that changes data must come from this site. The session cookie
 * is SameSite=Lax, which already keeps it off most cross-site requests; this
 * is the second lock, and the one that doesn't depend on which browser the
 * landlord uses. It runs before the session rules so that nothing — not the
 * sign-in routes NextAuth waves through — is exempt.
 */
export default function proxy(req: NextRequestWithAuth, event: NextFetchEvent) {
  if (
    req.nextUrl.pathname.startsWith("/api/") &&
    crossSiteMutation({
      method: req.method,
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
    })
  ) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  return withSession(req, event);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/attachments/:path*",
    "/api/backup/:path*",
    "/api/companies/:path*",
    "/api/export/:path*",
    "/api/invites/:path*",
    "/api/properties/:path*",
    "/api/recurring/:path*",
    "/api/requests/:path*",
    "/api/search",
    "/api/tenants/:path*",
    "/api/vendors/:path*",
    "/api/documents/:path*",
    "/api/transactions/:path*",
    "/api/units/:path*",
    // Public, but still covered by the cross-site check.
    "/api/auth/:path*",
    // The tenant side. The login and signup pages sit under /portal/login and
    // /portal/signup and are excluded, or nobody could ever sign in.
    "/portal",
    "/portal/((?!login|signup).*)",
    "/api/portal/:path*",
  ],
};
