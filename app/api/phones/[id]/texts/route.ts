import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { fetchFileText, newestIn } from "@/lib/phone-backup";
import { parseSmsXml } from "@/lib/sms-parse";

/**
 * The phone's latest backed-up text messages, grouped into conversations for
 * the viewer. Admin only. Parsing happens here so the browser gets clean JSON
 * instead of a big XML file.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  try {
    const newest = await newestIn(id, "Texts");
    if (!newest) return NextResponse.json({ conversations: [], backedUpAt: null });
    const xml = await fetchFileText(id, newest.path);
    const conversations = parseSmsXml(xml);
    return NextResponse.json({ conversations, backedUpAt: newest.mtime });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
