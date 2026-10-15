import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { fetchFileText, newestIn } from "@/lib/phone-backup";
import { parseAppsHtml } from "@/lib/apps-parse";

/** The phone's installed-app list, parsed for the viewer. Admin only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  try {
    const newest = await newestIn(id, "Apps");
    if (!newest) return NextResponse.json({ apps: [], backedUpAt: null });
    const html = await fetchFileText(id, newest.path);
    return NextResponse.json({ apps: parseAppsHtml(html), backedUpAt: newest.mtime });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
