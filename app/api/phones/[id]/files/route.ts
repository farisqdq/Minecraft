import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { listFiles } from "@/lib/phone-backup";

/** Browse one phone's backed-up folders. ?dir=Photos/DCIM/Camera (empty = top). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const dir = new URL(req.url).searchParams.get("dir") || "";
  try {
    return NextResponse.json(await listFiles(id, dir));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
