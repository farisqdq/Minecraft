/**
 * The address the site is reached at, for links that leave it: reset
 * emails, links an admin hands over.
 *
 * Never taken from the request. A deployment answers on several hostnames
 * (its own *.vercel.app name for one), and a request's Host header is
 * whatever the sender says it is — a reset link built from it would point
 * wherever an attacker liked, in an email that looks like ours. So in
 * production the origin is SITE_URL, or the site's own domain when that's
 * unset; only in development is it wherever the dev server is running.
 */

export const DEFAULT_SITE_URL = "https://eqal.rentals";

export function siteOrigin(requestUrl: string, env: Record<string, string | undefined> = process.env): string {
  if (env.NODE_ENV !== "production") return new URL(requestUrl).origin;
  const configured = env.SITE_URL?.trim();
  const chosen = configured && /^https?:\/\//.test(configured) ? configured : DEFAULT_SITE_URL;
  return chosen.replace(/\/+$/, "");
}
