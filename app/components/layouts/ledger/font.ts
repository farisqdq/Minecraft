import { Instrument_Sans } from "next/font/google";

/**
 * The Ledger layout's typeface. Self-hosted by next/font (no request to
 * Google at runtime, so the CSP's font-src 'self' covers it). The shell puts
 * its family into --font-ledger on <html>, which --font-sans reads.
 */
export const ledgerSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ledger",
});
