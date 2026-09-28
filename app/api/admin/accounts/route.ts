import { NextResponse } from "next/server";
import { adminSnapshot, requireAdmin } from "@/lib/admin-db";

/** Everything the admin panel shows. 404, not 403, for anyone else: the panel's existence is not theirs to learn. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await adminSnapshot());
}
