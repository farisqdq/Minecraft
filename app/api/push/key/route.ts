import { NextResponse } from "next/server";
import { vapidPublicKey } from "@/lib/push";

/** The public half of the VAPID pair — what a browser needs to subscribe. */
export async function GET() {
  const publicKey = vapidPublicKey();
  if (!publicKey) return NextResponse.json({ error: "Push notifications aren't set up on this site yet." }, { status: 503 });
  return NextResponse.json({ publicKey });
}
