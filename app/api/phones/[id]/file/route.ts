import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { fileLink } from "@/lib/phone-backup";

/**
 * Hands back a short-lived link straight to the file on the VPS, so the big
 * download (a video, a folder of photos) doesn't pass through Vercel. The
 * link is signed and good for ten minutes; the admin check happens here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const u = new URL(req.url);
  const path = u.searchParams.get("p") || "";
  if (!path) return NextResponse.json({ error: "no file" }, { status: 400 });
  const download = u.searchParams.get("download") === "1";
  return NextResponse.redirect(fileLink(id, path, download), { status: 307 });
}
