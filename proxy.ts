import withAuth from "next-auth/middleware";

export default withAuth;

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/backup/:path*",
    "/api/companies/:path*",
    "/api/properties/:path*",
    "/api/transactions/:path*",
  ],
};
