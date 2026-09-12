import withAuth from "next-auth/middleware";

export default withAuth;

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/properties/:path*",
    "/api/transactions/:path*",
  ],
};
