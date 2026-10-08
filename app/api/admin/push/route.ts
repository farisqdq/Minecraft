import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminDevices, adminSnapshot, logAdmin, requireAdmin } from "@/lib/admin-db";
import { pushConfigured } from "@/lib/push";
import { sendToDevices, type DeviceResult } from "@/lib/push-db";
import { MAX_PUSH_TIMES, checkCompose, parsePushTarget, parsePushTimes, selectTargets, sendTally } from "@/lib/push-rules";

/** Room for a 50-round broadcast; each send has its own 8-second timeout. */
export const maxDuration = 300;

/**
 * An admin's own notification: a title, a message and an optional link, to
 * one device, one person's devices, or every device on the site, as many
 * times as asked (each round a separate notification). Answers
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
  const times = parsePushTimes(body?.times);
  if (!times) return NextResponse.json({ error: `Send it from 1 to ${MAX_PUSH_TIMES} times.` }, { status: 400 });
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Push notifications aren't set up on this site (VAPID keys)." }, { status: 503 });
  }

  const devices = await adminDevices();
  const chosen = selectTargets(devices, target);
  if (chosen.length === 0) return NextResponse.json({ error: "No device with notifications on matches that." }, { status: 404 });

  const subs = await prisma.pushSubscription.findMany({
    where: { id: { in: chosen.map((d) => d.id) } },
    select: { id: true, endpoint: true, p256dh: true, auth: true, userAgent: true },
  });
  // Every round is its own notification (no tag), so the phone shows each
  // one. A device the push service says is gone drops out of later rounds;
  // when push isn't configured, one round says so and the rest are skipped.
  const payload = { title: compose.title, body: compose.body, url: compose.link || "/" };
  const all: DeviceResult[] = [];
  const latest = new Map<string, DeviceResult & { sentCount: number }>();
  let live = subs;
  for (let round = 0; round < times && live.length > 0; round++) {
    const results = await sendToDevices(live, payload);
    all.push(...results);
    for (const r of results) {
      const prev = latest.get(r.id);
      const sentCount = (prev?.sentCount ?? 0) + (r.sent ? 1 : 0);
      latest.set(r.id, { ...r, sent: sentCount > 0, sentCount });
    }
    if (results.some((r) => r.unconfigured)) break;
    const gone = new Set(results.filter((r) => r.removed).map((r) => r.id));
    live = live.filter((s) => !gone.has(s.id));
  }
  const tally = sendTally(all);

  const first = chosen[0];
  const label =
    target.kind === "everyone"
      ? `everyone (${chosen.length} device${chosen.length === 1 ? "" : "s"})`
      : target.kind === "device"
        ? `${first.who}'s ${first.device}`
        : `${first.who} (${chosen.length} device${chosen.length === 1 ? "" : "s"})`;
  const repeat = times > 1 ? ` ×${times}` : "";
  await logAdmin(admin, "push.send", label, `"${compose.title}"${repeat} — ${tally.text}`);

  const who = new Map(chosen.map((d) => [d.id, d.who]));
  return NextResponse.json({
    ...(await adminSnapshot()),
    results: [...latest.values()].map((r) => ({ ...r, who: who.get(r.id) ?? "" })),
    times,
    sent: tally.sent,
    failed: tally.failed,
  });
}
