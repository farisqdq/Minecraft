import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { notificationsFor } from "@/lib/notifications-db";
import { actionCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * The notification center's list (a34), and the number on the bell: how
 * many items need doing now. `?count=1` skips the list for the bell's poll.
 */
export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await notificationsFor(userId);
  const count = actionCount(items);
  if (new URL(req.url).searchParams.get("count")) return NextResponse.json({ count });
  return NextResponse.json({ count, items });
}
