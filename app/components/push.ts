/**
 * The browser side of push notifications: asking, subscribing, and telling
 * the server about this device. Everything checks for support first, so a
 * desktop browser or an older iPhone simply sees no button.
 */

export type PushState = "unsupported" | "denied" | "on" | "off";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Opened from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Ask, subscribe, register. The permission prompt comes first and straight
 * from the tap: Safari only allows it inside a user gesture, and waiting on
 * a network call first can lose that.
 */
export async function enablePush(): Promise<{ ok: true; devices: number } | { ok: false; reason: string }> {
  if (!pushSupported()) return { ok: false, reason: "This browser can't show notifications." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Notifications were not allowed. You can change that in your phone's settings for this app." };
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const keyRes = await fetch("/api/push/key");
    if (!keyRes.ok) return { ok: false, reason: "Push notifications aren't set up on this site yet." };
    const { publicKey } = await keyRes.json();
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: data?.error || "Couldn't register this device." };
    return { ok: true, devices: data.devices ?? 1 };
  } catch (err) {
    console.error("enablePush", err);
    return { ok: false, reason: "Couldn't turn notifications on. On an iPhone, open the site from your home screen first." };
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/push/test", { method: "POST" });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: r?.error || "Couldn't send a test." };
  if (r.unconfigured) return { ok: false, message: "Push notifications aren't set up on this site yet (VAPID keys)." };
  if (r.devices === 0) return { ok: false, message: "No device has notifications on yet." };
  if (r.sent > 0) return { ok: true, message: `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}. It should appear in a moment.` };
  return { ok: false, message: r.gone > 0 ? "This device had unsubscribed; tap Enable again." : "The push service refused it." };
}
