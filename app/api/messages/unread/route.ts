import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { landlordUnreadTotal } from "@/lib/messages-db";

/**
 * The number on the Messages tab. The shell asks for it itself, so no
 * page has to know about messages to show the badge.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ count: await landlordUnreadTotal(userId) });
}
