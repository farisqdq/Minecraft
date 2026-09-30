import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

// Every page is rendered per request. The Content-Security-Policy carries a
// fresh nonce each time (see proxy.ts), and a page built once at deploy time
// would ship scripts stamped with no nonce at all — which the policy refuses.
export const dynamic = "force-dynamic";

// One typeface, self-hosted by Next at build time: no third-party request at
// runtime (font-src 'self' covers it), no flash of a serif. Exposed as a CSS
// variable that --font-sans in globals.css builds on.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The layout leans on env(safe-area-inset-*) for the bottom tab bar, and
  // those only resolve to anything once the viewport covers the notch area.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
