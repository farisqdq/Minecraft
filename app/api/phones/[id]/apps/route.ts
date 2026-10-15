import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { newestIn } from "@/lib/phone-backup";

/** The path of the newest app-list file, for the viewer to show in a frame. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  try {
    const newest = await newestIn(id, "Apps");
    return NextResponse.json({ path: newest?.path ?? null, backedUpAt: newest?.mtime ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
