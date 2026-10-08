import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { parseSettings } from "@/lib/reminders";
import { reminderSnapshot, saveSettings, settingsFor } from "@/lib/reminders-db";

/** The company's reminder settings and what has gone out lately. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireCompany(userId, id, "viewer"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await reminderSnapshot(id));
}

/** Owners only: what goes out, how far ahead, and by which channels. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireCompany(userId, id, "owner"))) {
    return NextResponse.json({ error: "Only an owner can change reminders." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const current = await settingsFor(id);
  await saveSettings(id, parseSettings(body, current));
  return NextResponse.json(await reminderSnapshot(id));
}
