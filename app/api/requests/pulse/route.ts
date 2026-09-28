import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { messagePulse, repairPulse } from "@/lib/pulse";

/**
 * Has anything changed across this landlord's repairs or messages? See
 * lib/pulse.ts. One signature for both, so the shell's badges and the
 * pages that watch it all poll the same thing.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [repairs, messages] = await Promise.all([
    repairPulse({ property: { company: { members: { some: { userId } } } } }),
    messagePulse({ thread: { company: { members: { some: { userId } } } } }),
  ]);
  return NextResponse.json({ pulse: `${repairs}.${messages}` });
}
