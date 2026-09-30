import { prisma } from "@/lib/prisma";
import { sendPush, type PushPayload } from "@/lib/push";
import { describeDevice } from "@/lib/push-rules";

/**
 * Sending to stored devices, and writing down how each send went: a success
 * stamps lastUsedAt and clears the last error, a failure records the push
 * service's status and what it means, and a 404/410 (the device is gone for
 * good) removes the row. Both the reminders and the Admin page's sender go
 * through here, so "last successful send" means the same thing everywhere.
 */

export type StoredDevice = { id: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null };

export type DeviceResult = {
  id: string;
  device: string;
  sent: boolean;
  /** The push service's HTTP status, when it answered. */
  status?: number;
  /** What went wrong, in words, when it didn't send. */
  error?: string;
  /** The row was removed because the push service said the device is gone. */
  removed?: boolean;
  /** Push isn't configured; nothing was attempted. */
  unconfigured?: boolean;
};

export async function sendToDevices(subs: StoredDevice[], payload: PushPayload): Promise<DeviceResult[]> {
  const results: DeviceResult[] = [];
  for (const s of subs) {
    const device = describeDevice(s.userAgent);
    const r = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    if (r.sent) {
      results.push({ id: s.id, device, sent: true, status: r.status });
      await prisma.pushSubscription
        .update({ where: { id: s.id }, data: { lastUsedAt: new Date(), lastError: null, lastErrorAt: null } })
        .catch(() => undefined);
      continue;
    }
    if (r.reason === "unconfigured") {
      results.push({ id: s.id, device, sent: false, error: r.error, unconfigured: true });
      // Every other device would say the same.
      break;
    }
    if (r.reason === "gone") {
      await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      results.push({ id: s.id, device, sent: false, status: r.status, error: r.error, removed: true });
      continue;
    }
    // A 403 is left in place: it can also mean the site's own VAPID settings
    // are wrong, and removing on that would wipe every device at once. The
    // phone fixes itself the next time its owner opens notification settings.
    await prisma.pushSubscription
      .update({ where: { id: s.id }, data: { lastError: r.error.slice(0, 500), lastErrorAt: new Date() } })
      .catch(() => undefined);
    results.push({ id: s.id, device, sent: false, status: r.status, error: r.error });
  }
  return results;
}
