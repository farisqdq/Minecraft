/**
 * Keeps each serverless instance from hogging the database.
 *
 * Prisma's pool opens up to (cpus × 2 + 1) connections per instance, and
 * Vercel runs many instances — more right after a deploy, when the old
 * ones are still draining. A Postgres of the size a small landlord pays for
 * allows about a hundred connections in all. When that runs out, new
 * connections are refused outright: single-query pages that already hold a
 * connection keep working while the overview, which fans out a dozen
 * queries at once, fails every time. That is exactly what an outage on
 * 2026-09-28 looked like.
 *
 * So each instance is capped at a few connections, and waits a little
 * longer for one rather than failing the page. Anything already set in the
 * URL wins, so a pooled URL with its own limits is left alone.
 */
export function datasourceUrl(raw = process.env.DATABASE_URL ?? ""): string {
  if (!raw) return raw;
  const extras: string[] = [];
  if (!/[?&]connection_limit=/.test(raw)) extras.push("connection_limit=3");
  if (!/[?&]pool_timeout=/.test(raw)) extras.push("pool_timeout=20");
  if (extras.length === 0) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}${extras.join("&")}`;
}
