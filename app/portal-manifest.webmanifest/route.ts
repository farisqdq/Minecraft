import { NextResponse } from "next/server";
import { ICONS } from "../manifest";

/**
 * The tenant portal's own manifest: the same app, opening on /portal. A
 * tenant who installs from the portal must not land on the landlord
 * sign-in, which is where the main manifest's start_url would send them.
 */
export function GET() {
  return NextResponse.json(
    {
      id: "/portal",
      name: "Rent Roll",
      short_name: "Rent Roll",
      description: "Your rental: report repairs, see your account, hear from your landlord.",
      start_url: "/portal",
      scope: "/",
      display: "standalone",
      background_color: "#f5f6f8",
      theme_color: "#0f7a55",
      orientation: "any",
      icons: ICONS,
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
  );
}
