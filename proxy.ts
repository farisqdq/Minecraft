import withAuth from "next-auth/middleware";

export default withAuth;

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/attachments/:path*",
    "/api/backup/:path*",
    "/api/companies/:path*",
    "/api/export/:path*",
    "/api/properties/:path*",
    "/api/recurring/:path*",
    "/api/tenants/:path*",
    "/api/transactions/:path*",
    "/api/units/:path*",
  ],
};
