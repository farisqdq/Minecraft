/**
 * Which database URL to use, and with what limits — chosen so that many
 * serverless instances don't exhaust a small Postgres between them.
 *
 * Outage, 2026-09-28: /api/health reported "FATAL: too many connections
 * for role". Prisma's pool opens up to (cpus × 2 + 1) connections per
 * instance; Vercel runs many instances, more right after a deploy while the
 * old ones drain, and the database allowed about a hundred in all. Once that
 * ran out, new connections were refused outright: pages already holding a
 * connection kept working while the overview, which fans out a dozen
 * queries, failed nearly every time.
 *
 * Two defences, in order of how much they help:
 *
 *  1. A pooled URL. Vercel's Postgres integration provides one as
 *     POSTGRES_PRISMA_URL (PgBouncer in front of the database, thousands of
 *     client connections multiplexed onto a few real ones), and it is used
 *     ahead of DATABASE_URL whenever it's set. Migrations keep using
 *     DATABASE_URL from the schema, which is what a direct URL is for.
 *  2. One connection per instance. Queries on an instance then run one at a
 *     time — the overview's dozen take about a tenth of a second all told —
 *     and a busy moment queues for up to twenty seconds rather than failing
 *     the page. Anything the URL sets itself wins over these defaults.
 */

export type DatasourceChoice = { url: string; source: "POSTGRES_PRISMA_URL" | "DATABASE_URL" | "none" };

export function chooseDatasource(env: Record<string, string | undefined> = process.env): DatasourceChoice {
  if (env.POSTGRES_PRISMA_URL) return { url: env.POSTGRES_PRISMA_URL, source: "POSTGRES_PRISMA_URL" };
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, source: "DATABASE_URL" };
  return { url: "", source: "none" };
}

export function datasourceUrl(raw = chooseDatasource().url): string {
  if (!raw) return raw;
  const extras: string[] = [];
  // A pooler multiplexes for us; serialising onto one connection behind it
  // would only slow things down. The cap is for a direct connection.
  if (!/[?&]connection_limit=/.test(raw) && !isPooled(raw)) extras.push("connection_limit=1");
  if (!/[?&]pool_timeout=/.test(raw)) extras.push("pool_timeout=20");
  if (extras.length === 0) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}${extras.join("&")}`;
}

/** Whether a URL goes through a connection pooler, as far as its shape says. */
export function isPooled(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = url;
  }
  return (
    host.includes("-pooler") || // Neon
    host.startsWith("pooled.") || // Prisma Postgres
    host.includes("pooler.") || // Supabase
    /[?&]pgbouncer=true/.test(url) ||
    /:6543\//.test(url)
  );
}
