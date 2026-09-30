import { Geist } from "next/font/google";

/**
 * The Command Center's typeface. Self-hosted by next/font, exposed as
 * --font-geist; the layout's --font-sans points at it.
 */
export const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});
