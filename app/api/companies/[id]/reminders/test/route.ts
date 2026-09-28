import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requireCompany } from "@/lib/access";
import { isChannel } from "@/lib/notify";
import { sendTest } from "@/lib/reminders-db";
import { siteOrigin } from "@/lib/site";

/** A sample reminder to whoever pressed the button, by the channel they chose. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await requireCompany(me.id, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const channel = body?.channel;
  if (!isChannel(channel)) return NextResponse.json({ error: "Choose email or push." }, { status: 400 });
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  const result = await sendTest({
    companyId: id,
    companyName: company?.name ?? "Rent Roll",
    user: { id: me.id, email: me.email, name: me.name },
    channel,
    origin: siteOrigin(req.url),
  });
  return NextResponse.json(result);
}
