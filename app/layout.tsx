import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Sans, Manrope } from "next/font/google";
import Providers from "./providers";
import { getRequestAppearance, getRequestViewOnly } from "@/lib/appearance-server";
import { htmlAttributes, themeColors } from "@/lib/appearance";
import "./globals.css";

// Every page is rendered per request. The Content-Security-Policy carries a
// fresh nonce each time (see proxy.ts), and a page built once at deploy time
// would ship scripts stamped with no nonce at all — which the policy refuses.
export const dynamic = "force-dynamic";

// The new layouts' typefaces, self-hosted by Next at build time (font-src
// 'self' covers them, no third-party request at runtime). Each is only a CSS
// variable here; globals.css picks one per layout, and a face is downloaded
// only when a page actually uses it — Classic never does.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap", preload: false });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap", preload: false });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Rent Roll",
  description: "Track rent payments and repair costs across your rental properties.",
  applicationName: "Rent Roll",
  // Lets iOS run it full-screen from the home screen, with the status bar
  // tinted to match the page rather than a white strip above it.
  appleWebApp: {
    capable: true,
    title: "Rent Roll",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export async function generateViewport(): Promise<Viewport> {
  return {
    width: "device-width",
    initialScale: 1,
    // The layout leans on env(safe-area-inset-*) for the bottom tab bar, and
    // those only resolve to anything once the viewport covers the notch area.
    viewportFit: "cover",
    // The browser chrome matches the page the person chose to see.
    themeColor: themeColors(await getRequestAppearance()),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The signed-in person's layout, mode and accent go on <html> here, in the
  // server's HTML, so the first paint is already right (no flash).
  const appearance = await getRequestAppearance();
  const viewOnly = await getRequestViewOnly();
  return (
    <html
      lang="en"
      className={`${geist.variable} ${instrument.variable} ${manrope.variable}`}
      {...htmlAttributes(appearance)}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <Providers viewOnly={viewOnly}>{children}</Providers>
      </body>
    </html>
  );
}
