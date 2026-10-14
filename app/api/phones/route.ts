import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-db";
import { getSummary, addPhone, phoneBackupConfigured, phoneBackupHost, isBackupDown } from "@/lib/phone-backup";

/** The phones and the VPS server's disk. 404 for anyone who isn't the site admin. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!phoneBackupConfigured()) return NextResponse.json({ configured: false });
  try {
    const summary = await getSummary();
    return NextResponse.json({ configured: true, host: phoneBackupHost(), ...summary });
  } catch (e) {
    return NextResponse.json({ configured: true, host: phoneBackupHost(), down: isBackupDown(e), error: (e as Error).message }, { status: 200 });
  }
}

/** Add a phone; returns it with its setup code. */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const name = (body?.name || "").toString().trim();
  if (!name) return NextResponse.json({ error: "Give the phone a name." }, { status: 400 });
  try {
    return NextResponse.json(await addPhone(name));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
