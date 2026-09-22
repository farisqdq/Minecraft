import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { requireTenant } from "@/lib/access";
import { rentNoticeBody, smsWithBody, type NoticeDTO } from "@/lib/notices";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

function serialize(n: {
  id: string;
  kind: string;
  month: string | null;
  amount: number | null;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  sentBy: { name: string | null; email: string } | null;
}): NoticeDTO {
  return {
    id: n.id,
    kind: n.kind === "note" ? "note" : "rent",
    month: n.month ?? "",
    amount: n.amount ?? 0,
    body: n.body,
    sentBy: n.sentBy?.name || n.sentBy?.email || "",
    createdAt: iso(n.createdAt),
    readAt: iso(n.readAt),
  };
}

const withSender = { sentBy: { select: { name: true, email: true } } };

/** Everything you've ever sent this tenant, newest first. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await requireTenant(me.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await prisma.tenantNotice.findMany({
    where: { tenantId: id },
    include: withSender,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows.map(serialize));
}

/**
 * Chase this month's rent.
 *
 * The figures come from the request because the dashboard has already worked
 * out what's expected against the rent history and what's been paid; they're
 * clamped here so a bad body can't write a nonsense number into the record,
 * and frozen once written — a payment tomorrow shouldn't rewrite what you
 * told them today.
 *
 * The reply carries a ready-made sms: link. The app sends nothing itself:
 * there's no mail or SMS service wired up, and a link that opens your own
 * messaging app with the text in it needs neither and arrives from your own
 * number, which is the one they'll recognise.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tenant = await requireTenant(me.id, id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const kind = body?.kind === "note" ? "note" : "rent";
  const custom = typeof body?.body === "string" ? body.body.trim().slice(0, 2000) : "";

  const property = await prisma.property.findUnique({
    where: { id: tenant.propertyId },
    select: { name: true, company: { select: { name: true, contactPhone: true } } },
  });
  if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const unit = tenant.unitId
    ? await prisma.unit.findUnique({ where: { id: tenant.unitId }, select: { name: true } })
    : null;
  const place = [property.name, unit?.name].filter(Boolean).join(" — ");

  let month: string | null = null;
  let amount: number | null = null;
  let text = custom;

  if (kind === "rent") {
    const raw = typeof body?.month === "string" ? body.month : "";
    if (!/^\d{4}-\d{2}$/.test(raw)) {
      return NextResponse.json({ error: "Which month?" }, { status: 400 });
    }
    month = raw;
    const expected = Math.max(0, Number(body?.expected) || 0);
    const paid = Math.max(0, Math.min(expected, Number(body?.paid) || 0));
    if (expected <= 0) {
      return NextResponse.json({ error: "There's nothing outstanding." }, { status: 400 });
    }
    amount = expected - paid;
    if (amount <= 0) {
      return NextResponse.json({ error: "That month is paid up." }, { status: 400 });
    }
    text =
      custom ||
      rentNoticeBody({
        tenantName: tenant.name,
        month: raw,
        expected,
        paid,
        company: property.company.name,
        place,
      });
  }

  if (!text) return NextResponse.json({ error: "Nothing to send." }, { status: 400 });

  const notice = await prisma.tenantNotice.create({
    data: { tenantId: id, kind, month, amount, body: text, sentById: me.id },
    include: withSender,
  });

  return NextResponse.json(
    {
      notice: serialize(notice),
      // Their own number if you have it; the LLC's line is what they'd see as
      // the sender if you used it, so it isn't offered as a destination.
      smsHref: tenant.phone ? smsWithBody(tenant.phone, text) : "",
      hasPhone: Boolean(tenant.phone),
    },
    { status: 201 }
  );
}
