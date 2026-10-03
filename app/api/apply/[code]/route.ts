import { NextResponse } from "next/server";
import { CODE_PATTERN, parseApplication } from "@/lib/listings";
import { submitApplication } from "@/lib/listings-db";
import { clientIp } from "@/lib/throttle";
import { isoDay } from "@/lib/lease";
import { siteOrigin } from "@/lib/site";

/**
 * The public application form's endpoint (a27). No session: the listing's
 * code is the key. Throttled per address; a bot that fills the hidden field
 * is told it worked and nothing is kept.
 */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!CODE_PATTERN.test(code)) return NextResponse.json({ error: "This listing isn't taking applications." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = parseApplication(body, isoDay(new Date()));
  if (!parsed.ok) {
    if ("spam" in parsed) return NextResponse.json({ ok: true }, { status: 201 });
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result = await submitApplication(code, parsed.value, clientIp(req.headers), siteOrigin(req.url));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { status: 201 });
}
