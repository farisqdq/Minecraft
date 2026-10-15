import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { listFiles } from "@/lib/phone-backup";

const IMAGE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i;
const VIDEO = /\.(mp4|mov|m4v|3gp|mkv|webm|avi)$/i;

/**
 * A flat, newest-first list of all photos and videos for the gallery, walked
 * from the phone's Photos tree. Admin only. Capped so a huge library can't
 * stall the page; folders can still be browsed on the Phones page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const items: { path: string; name: string; size: number; mtime: string; video: boolean }[] = [];
  const queue = ["Photos"];
  let folders = 0;
  try {
    while (queue.length && folders < 400 && items.length < 4000) {
      const dir = queue.shift()!;
      folders++;
      const { entries } = await listFiles(id, dir);
      for (const e of entries || []) {
        if (e.dir) { queue.push(e.path); continue; }
        if (IMAGE.test(e.name) || VIDEO.test(e.name)) {
          items.push({ path: e.path, name: e.name, size: e.size, mtime: e.mtime, video: VIDEO.test(e.name) });
        }
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return NextResponse.json({ items, capped: items.length >= 4000 });
}
