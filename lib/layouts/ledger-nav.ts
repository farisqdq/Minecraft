/**
 * Small pure helpers for the Ledger layout's frame.
 */

/**
 * Whether a nav item is the current section. "/dashboard" must not light up
 * for every page nested under it; `match` lets an item own a path other than
 * its link (Properties links to the Overview's rent roll but owns
 * /dashboard/properties/…).
 */
export function isNavOn(pathname: string, href: string, match?: string): boolean {
  if (match) return pathname === match || pathname.startsWith(`${match}/`);
  const path = href.split("#")[0];
  if (path === "/dashboard") return pathname === "/dashboard";
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** "Dana Whitfield" → "DW"; "landlord@demo.local" → "L". */
export function initialsOf(label: string): string {
  const name = label.includes("@") ? label.split("@")[0] : label;
  const words = name
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (label.includes("@") || words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
