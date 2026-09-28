import { NextResponse } from "next/server";
import { passwordProblem } from "@/lib/portal";
import { MAX_PER_IP, clientIp, ipKey, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { acceptOwnerInvite, previewInvite } from "@/lib/owners-db";

/**
 * Turn an invite link into an owner login. Public by necessity — the
 * person using it has no session yet — so the token is the whole gate: it
 * names one email and one set of properties, works once, and expires.
 * Nothing in the request says which properties the new login can see.
 */

/** What the accept page shows before asking for a password. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const addressKey = ipKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  const preview = await previewInvite(token);
  if (!preview) {
    // A miss counts against the address, so links can't be walked through.
    await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return NextResponse.json({ error: "That link isn't valid — it may have been used already or expired." }, { status: 404 });
  }
  return NextResponse.json(preview);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = body?.token;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const addressKey = ipKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });

  const result = await acceptOwnerInvite({ token, name, password });
  if (!result.ok) {
    if (result.status === 404 || result.status === 403) await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, email: result.email });
}
