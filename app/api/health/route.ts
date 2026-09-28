import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chooseDatasource, isPooled } from "@/lib/prisma-url";

export const dynamic = "force-dynamic";

/**
 * Whether the app can reach its database, and if not, why — in enough
 * detail to act on, without giving away where the database is.
 *
 * No session needed: when the database is refusing connections, every
 * signed-in page is a 500 and the only way to learn the cause is a route
 * that says so. Hosts, users and anything quoted in the error are redacted,
 * so what's left is the shape of the failure — "too many connections",
 * "can't reach" — not the coordinates.
 */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "up", ms: Date.now() - started, ...where() });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json(
      {
        ok: false,
        database: "down",
        ms: Date.now() - started,
        ...where(),
        code: err.code ?? null,
        error: redact(err.message ?? String(e)),
      },
      { status: 503 }
    );
  }
}

/** Which URL is in use and whether it's a pooled one — the first thing to check. */
function where() {
  const choice = chooseDatasource();
  return { source: choice.source, pooled: isPooled(choice.url) };
}

function redact(message: string): string {
  return message
    .replace(/`[^`]*`/g, "`…`")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/[\w.-]+@[\w.-]+/g, "…")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "…")
    .slice(0, 400);
}
