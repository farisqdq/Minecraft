import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminDevices, adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";
import { pushConfigured } from "@/lib/push";
import { sendToDevices } from "@/lib/push-db";
import { adminPushKeys, checkCompose, parsePushTarget, pushPausedMessage, selectTargets, sendTally } from "@/lib/push-rules";
import { isThrottled, recordFailure } from "@/lib/throttle";

/**
 * An admin's own notification: a title, a message and an optional link, to
 * one device, one person's devices, or every device on the site. Answers
 * with how each device went (the push service's status code on a refusal)
 * and a fresh snapshot, so the device list and the audit log are current.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const compose = checkCompose(body ?? {});
  if (!compose.ok) return NextResponse.json({ error: compose.error }, { status: 400 });
  const target = parsePushTarget(body?.target);
  if (!target) return NextResponse.json({ error: "Choose who it goes to." }, { status: 400 });
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Push notifications aren't set up on this site (VAPID keys)." }, { status: 503 });
  }

  const devices = await adminDevices();
  const chosen = selectTargets(devices, target);
  if (chosen.length === 0) return NextResponse.json({ error: "No device with notifications on matches that." }, { status: 404 });

  const keys = adminPushKeys(admin.id, target);
  const paused = await isThrottled(keys.map((k) => k.key));
  if (paused > 0) return NextResponse.json({ error: pushPausedMessage(paused) }, { status: 429 });
  // Counted before sending, so the ceiling holds even when sends fail or race.
  await recordFailure(keys);

  const subs = await prisma.pushSubscription.findMany({
    where: { id: { in: chosen.map((d) => d.id) } },
    select: { id: true, endpoint: true, p256dh: true, auth: true, userAgent: true },
  });
  const results = await sendToDevices(subs, { title: compose.title, body: compose.body, url: compose.link || "/" });
  const tally = sendTally(results);

  const first = chosen[0];
  const label =
    target.kind === "everyone"
      ? `everyone (${chosen.length} device${chosen.length === 1 ? "" : "s"})`
      : target.kind === "device"
        ? `${first.who}'s ${first.device}`
        : `${first.who} (${chosen.length} device${chosen.length === 1 ? "" : "s"})`;
  await logAdmin(admin, "push.send", label, `"${compose.title}" — ${tally.text}`);

  const who = new Map(chosen.map((d) => [d.id, d.who]));
  return NextResponse.json({
    ...(await adminSnapshot()),
    results: results.map((r) => ({ ...r, who: who.get(r.id) ?? "" })),
    sent: tally.sent,
    failed: tally.failed,
  });
}
