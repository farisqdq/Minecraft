import { NextResponse } from "next/server";
import { MAX_PER_IP, clientIp, ipKey, isThrottled, pauseMessage, recordFailure } from "@/lib/throttle";
import { useOwnerReset } from "@/lib/owner-reset-db";

/** Set a new owner-portal password from a reset link. */
export async function POST(req: Request) {
  const addressKey = ipKey(clientIp(req.headers));
  const paused = await isThrottled([addressKey]);
  if (paused) return NextResponse.json({ error: pauseMessage(paused) }, { status: 429 });
  const body = await req.json().catch(() => null);
  const result = await useOwnerReset(body?.token, body?.password);
  if (!result.ok) {
    // A wrong or used token counts against the address, like a wrong password.
    if (result.badToken) await recordFailure([{ key: addressKey, max: MAX_PER_IP }]);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
