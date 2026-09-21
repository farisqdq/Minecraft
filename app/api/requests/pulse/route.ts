import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { repairPulse } from "@/lib/pulse";

/** Has anything changed across this landlord's repairs? See lib/pulse.ts. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pulse = await repairPulse({ property: { company: { members: { some: { userId } } } } });
  return NextResponse.json({ pulse });
}
