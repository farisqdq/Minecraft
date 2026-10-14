import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { renamePhone, removePhone, newCode, requestBackup } from "@/lib/phone-backup";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "code") return NextResponse.json(await newCode(id));
    if (body?.action === "request") return NextResponse.json(await requestBackup(id));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const name = (body?.name || "").toString().trim();
  if (!name) return NextResponse.json({ error: "Give the phone a name." }, { status: 400 });
  try {
    return NextResponse.json(await renamePhone(id, name));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const withFiles = new URL(req.url).searchParams.get("files") === "1";
  try {
    return NextResponse.json(await removePhone(id, withFiles));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
