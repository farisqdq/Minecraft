/**
 * Where to send someone after they sign in, taken from `?callbackUrl=`.
 *
 * That value comes from the address bar, so anyone can write it: a link to
 * the real login page with `callbackUrl=https://look-alike.example` would
 * otherwise sign the landlord in and then hand them to a copy of the site
 * asking them to "confirm your password". Only a path on this site is
 * accepted; anything else falls back to the default.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  // A path on this site starts with exactly one "/". "//host" and "/\host"
  // are read by browsers as another site; a scheme ("https:", "javascript:")
  // can't start with "/" at all.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters (tabs, newlines) are stripped by browsers before
  // parsing, which can turn "/\t/evil.example" into "//evil.example".
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    // Resolve against a throwaway origin; if it lands anywhere else, refuse.
    const url = new URL(value, "https://this.site");
    if (url.origin !== "https://this.site") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
