import webpush from "web-push";

/**
 * Sending one push notification to one device.
 *
 * Web Push needs a VAPID key pair: the public half is handed to the browser
 * when it subscribes, the private half signs every message so the push
 * service (Apple's, Google's, Mozilla's) knows it's this site. With the keys
 * unset, sendPush says it didn't send, and nothing else minds.
 */

export type PushKeys = { endpoint: string; keys: { p256dh: string; auth: string } };

export type PushPayload = { title: string; body: string; url: string; tag?: string };

export type PushResult =
  | { sent: true }
  /** "gone" is the push service saying the device unsubscribed: forget it. */
  | { sent: false; reason: "unconfigured" | "gone" | "failed" };

export function pushConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function vapidPublicKey(env: Record<string, string | undefined> = process.env): string {
  return env.VAPID_PUBLIC_KEY ?? "";
}

export async function sendPush(
  subscription: PushKeys,
  payload: PushPayload,
  env: Record<string, string | undefined> = process.env
): Promise<PushResult> {
  if (!pushConfigured(env)) return { sent: false, reason: "unconfigured" };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject: env.VAPID_SUBJECT!, publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! },
      // A rent reminder a day late is still worth having; a week late is not.
      TTL: 24 * 60 * 60,
      timeout: 8000,
      ...(env.HTTPS_PROXY ? { proxy: env.HTTPS_PROXY } : {}),
    });
    return { sent: true };
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return { sent: false, reason: "gone" };
    console.error("Push failed", code ?? err);
    return { sent: false, reason: "failed" };
  }
}
