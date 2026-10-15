import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { fetchFileText, newestIn } from "@/lib/phone-backup";
import { parseVcf } from "@/lib/contacts-parse";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  try {
    const newest = await newestIn(id, "Contacts");
    if (!newest) return NextResponse.json({ contacts: [], backedUpAt: null });
    const vcf = await fetchFileText(id, newest.path);
    return NextResponse.json({ contacts: parseVcf(vcf), backedUpAt: newest.mtime });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
