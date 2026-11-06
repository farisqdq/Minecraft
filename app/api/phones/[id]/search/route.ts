import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { searchPhotos } from "@/lib/phone-backup";

/**
 * Search one phone's photos by what's in them. ?q=beach → the best matches,
 * best first; no q → how far the backup server has got learning them. The
 * matching happens on the backup server; nothing goes anywhere else.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 200);
  try {
    return NextResponse.json(await searchPhotos(id, q));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
