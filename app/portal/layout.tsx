import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Installing from the portal opens on the portal — see app/portal-manifest.webmanifest. */
export const metadata: Metadata = { manifest: "/portal-manifest.webmanifest" };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
