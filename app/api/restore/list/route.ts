import { NextResponse } from "next/server";
import { listFiles, restoreTokenValid } from "@/lib/phone-backup";

/** Browse a phone's backup from a restore link — no login, token-gated. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const d = u.searchParams.get("d") || "";
  const e = u.searchParams.get("e") || "";
  const s = u.searchParams.get("s") || "";
  if (!restoreTokenValid(d, e, s)) return NextResponse.json({ error: "This restore link isn't valid or has expired." }, { status: 403 });
  const dir = u.searchParams.get("dir") || "";
  try {
    return NextResponse.json(await listFiles(d, dir));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
