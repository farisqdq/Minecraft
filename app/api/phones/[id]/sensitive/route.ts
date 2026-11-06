import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { restoreSensitiveList, rescanSensitive, sensitiveState } from "@/lib/phone-backup";

/** The sensitive-photo check for one phone: counts, saved lists and progress. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  try {
    return NextResponse.json(await sensitiveState(id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/**
 * { action: "rescan" } re-checks every photo (keeping "not sensitive" marks);
 * { action: "restore", name } puts a saved list back. Either way the backup
 * server saves the current list first, so both can be undone.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; name?: unknown };
  try {
    if (body.action === "rescan") return NextResponse.json(await rescanSensitive(id));
    if (body.action === "restore" && typeof body.name === "string" && /^[\w.-]{1,80}\.json$/.test(body.name)) {
      return NextResponse.json(await restoreSensitiveList(id, body.name));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
