import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { inboxFor } from "@/lib/messages-db";

/** Every conversation across this landlord's LLCs, newest activity first — the inbox. */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await inboxFor(userId));
}
