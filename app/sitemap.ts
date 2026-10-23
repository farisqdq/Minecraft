import type { MetadataRoute } from "next";

/** Only the public pages. Signed-in areas and private links are left out on purpose. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://eqal.rentals";
  return ["", "/login", "/privacy", "/terms", "/cookies"].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path ? "yearly" : "monthly",
    priority: path ? 0.3 : 1,
  }));
}
