import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest. This is what makes "Add to Home Screen"
 * produce a real app icon that opens without browser chrome — which matters
 * because most of the logging happens standing in a doorway on a phone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rent Roll",
    short_name: "Rent Roll",
    description: "Track rent payments and repair costs across your rental properties.",
    // Signed-out visitors get redirected to /login from here anyway, so the
    // app always opens on the thing you came to do.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f4f1e9",
    theme_color: "#2f6844",
    orientation: "any",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
