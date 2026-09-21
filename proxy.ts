import withAuth from "next-auth/middleware";

/** Everything a tenant is allowed to reach once signed in. */
const TENANT_AREA = ["/portal", "/api/portal"];

/**
 * The outer wall. Route handlers check again with getCurrentUserId or
 * requireTenantSession — this is not the only lock — but it means a tenant
 * token never even reaches the landlord code, and vice versa.
 *
 * /portal/login and /portal/signup are deliberately outside the matcher
 * below: you have to be able to get to them without a session.
 */
export default withAuth({
  callbacks: {
    authorized({ req, token }) {
      if (!token) return false;
      const tenant = token.kind === "tenant";
      const inTenantArea = TENANT_AREA.some(
        (base) => req.nextUrl.pathname === base || req.nextUrl.pathname.startsWith(`${base}/`)
      );
      return inTenantArea ? tenant : !tenant;
    },
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/attachments/:path*",
    "/api/backup/:path*",
    "/api/companies/:path*",
    "/api/export/:path*",
    "/api/properties/:path*",
    "/api/recurring/:path*",
    "/api/search",
    "/api/tenants/:path*",
    "/api/transactions/:path*",
    "/api/units/:path*",
    // The tenant side. The login and signup pages sit under /portal/login and
    // /portal/signup and are excluded, or nobody could ever sign in.
    "/portal",
    "/portal/((?!login|signup).*)",
    "/api/portal/((?!signup).*)",
  ],
};
