import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runReminders } from "@/lib/reminders-db";
import { siteOrigin } from "@/lib/site";

/**
 * The daily run, called by Vercel's cron (see vercel.json) with the
 * CRON_SECRET it was given. Anyone else gets nothing. Safe to call again:
 * everything it sends is claimed under a key first (lib/reminders-db).
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(header: string | null, secret: string): boolean {
  const given = header?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET isn't set, so the daily run is off." }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const report = await runReminders(new Date(), siteOrigin(req.url));
  console.log("Reminders", JSON.stringify(report));
  return NextResponse.json(report);
}
