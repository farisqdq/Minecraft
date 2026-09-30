import webpush from "web-push";
import { pushFailureMessage, pushIsGone } from "@/lib/push-rules";

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
  | { sent: true; status: number }
  /**
   * "gone" is the push service saying the device unsubscribed (404/410):
   * forget it. "failed" is anything else; `status` is the push service's
   * HTTP status when it answered at all, and `error` says what it means.
   */
  | { sent: false; reason: "unconfigured" | "gone" | "failed"; status?: number; error: string };

/** Env values pasted into a dashboard pick up newlines and spaces; a key with either fails every time. */
const clean = (v: string | undefined) => (v ?? "").trim();

export function pushConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(clean(env.VAPID_PUBLIC_KEY) && clean(env.VAPID_PRIVATE_KEY) && clean(env.VAPID_SUBJECT));
}

export function vapidPublicKey(env: Record<string, string | undefined> = process.env): string {
  return clean(env.VAPID_PUBLIC_KEY);
}

/**
 * How long a push service holds a message for a phone that's off: a rent
 * reminder a day late is still worth having; a week late is not.
 */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;

export async function sendPush(
  subscription: PushKeys,
  payload: PushPayload,
  env: Record<string, string | undefined> = process.env
): Promise<PushResult> {
  if (!pushConfigured(env)) return { sent: false, reason: "unconfigured", error: "Push notifications aren't set up on this site (VAPID keys)." };
  try {
    const res = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject: clean(env.VAPID_SUBJECT), publicKey: clean(env.VAPID_PUBLIC_KEY), privateKey: clean(env.VAPID_PRIVATE_KEY) },
      TTL: PUSH_TTL_SECONDS,
      // Without this Android treats every message as "normal" priority and
      // holds it while the phone dozes — which, for a phone on a table, is
      // most of the time. Every message here is one a person asked for.
      urgency: "high",
      timeout: 8000,
      ...(env.HTTPS_PROXY ? { proxy: env.HTTPS_PROXY } : {}),
    });
    return { sent: true, status: res?.statusCode ?? 201 };
  } catch (err) {
    const e = err as { statusCode?: number; body?: unknown; message?: string };
    const status = typeof e.statusCode === "number" ? e.statusCode : undefined;
    // The service's own reply says why (FCM: "the key in the authorization
    // header does not correspond…"); with no status, the error is ours —
    // a malformed key or subject, or no route to the service.
    const detail = status ? (typeof e.body === "string" ? e.body : "") : e.message ?? String(err);
    console.error("Push failed", status ?? "", detail.slice(0, 300));
    const error = pushFailureMessage(status, detail);
    if (pushIsGone(status)) return { sent: false, reason: "gone", status, error };
    return { sent: false, reason: "failed", status, error };
  }
}
