import { NextResponse } from "next/server";
import { fileLink, thumbLink, restoreTokenValid } from "@/lib/phone-backup";

/** Download one file from a restore link. Re-checks the token, then hands back a short-lived VPS link. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const d = u.searchParams.get("d") || "";
  const e = u.searchParams.get("e") || "";
  const s = u.searchParams.get("s") || "";
  const p = u.searchParams.get("p") || "";
  if (!restoreTokenValid(d, e, s)) return new NextResponse("This restore link isn't valid or has expired.", { status: 403 });
  if (!p) return new NextResponse("no file", { status: 400 });
  const download = u.searchParams.get("download") === "1";
  if (u.searchParams.get("thumb") === "1") return NextResponse.redirect(thumbLink(d, p, u.searchParams.get("w") === "1600"), { status: 307 });
  return NextResponse.redirect(fileLink(d, p, download), { status: 307 });
}
