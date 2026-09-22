import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { requireDocument } from "@/lib/access";
import { blobConfigured } from "@/lib/blob";
import { normalizeKind } from "@/lib/documents";
import { documentInclude, parseDay, serializeDocument } from "@/lib/documents-db";

/**
 * Change the details — most often the expiry date, when the renewed
 * certificate arrives. The file itself isn't replaced here: a new one is a
 * new upload, so the old one stays on record until someone removes it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await requireDocument(userId, id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const data: Record<string, unknown> = {};
  if (typeof body?.title === "string") {
    const title = body.title.trim().slice(0, 120);
    if (!title) return NextResponse.json({ error: "Give it a name." }, { status: 400 });
    data.title = title;
  }
  if ("kind" in (body ?? {})) data.kind = normalizeKind(body.kind);
  if ("expiresOn" in (body ?? {})) {
    const raw = typeof body.expiresOn === "string" ? body.expiresOn.trim() : "";
    const d = parseDay(raw);
    if (raw && !d) return NextResponse.json({ error: "That expiry date isn't a date." }, { status: 400 });
    data.expiresOn = d;
  }
  if (typeof body?.note === "string") data.note = body.note.trim().slice(0, 500) || null;
  if ("shared" in (body ?? {})) data.shared = Boolean(doc.tenantId) && body.shared === true;

  const fresh = await prisma.document.update({ where: { id }, data, include: documentInclude });
  return NextResponse.json(serializeDocument(fresh));
}

/** Remove the document and its file. Owners only: it's the only copy. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await requireDocument(userId, id, "owner");
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The row goes regardless: a row pointing at a missing file is a broken
  // link, a file with no row is invisible and costs pennies.
  if (blobConfigured()) await del(doc.url).catch(() => undefined);
  await prisma.document.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
