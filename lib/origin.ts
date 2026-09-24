/**
 * Whether a request that changes something came from this site.
 *
 * Browsers attach the `Origin` header to every cross-site request and to
 * same-site requests that aren't GET, and a page cannot forge it. So a
 * POST whose Origin names another site is another site trying to act with
 * the landlord's cookies (cross-site request forgery), and is refused.
 *
 * No Origin at all means the request didn't come from a browser page —
 * curl, a script, a server — which carries no one else's cookies, so there
 * is nothing to forge and it is left to the route's own checks.
 */
export function crossSiteMutation(opts: {
  method: string;
  origin: string | null;
  host: string | null;
  forwardedHost?: string | null;
}): boolean {
  const method = opts.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const origin = opts.origin;
  if (!origin) return false;
  // "null" is what sandboxed frames and some redirects send: not this site.
  if (origin === "null") return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true;
  }
  const allowed = [opts.forwardedHost, opts.host]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return !allowed.includes(originHost);
}
