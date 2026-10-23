import type { MetadataRoute } from "next";

/** Public pages may be crawled; everything behind a sign-in or a private link may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/cookies", "/rent/"],
      disallow: ["/api/", "/dashboard", "/owners", "/portal", "/restore", "/reset", "/forgot"],
    },
    sitemap: "https://eqal.rentals/sitemap.xml",
  };
}
