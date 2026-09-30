/**
 * The browser side of push notifications: asking, subscribing, and telling
 * the server about this device. Everything checks for support first, so a
 * desktop browser or an older iPhone simply sees no button.
 */
import { base64UrlToBytes, sameApplicationServerKey } from "@/lib/push-rules";

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

/** What the browser alone says. syncPush asks the server too. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

async function currentPublicKey(): Promise<string | null> {
  const keyRes = await fetch("/api/push/key");
  if (!keyRes.ok) return null;
  const { publicKey } = await keyRes.json();
  return typeof publicKey === "string" && publicKey ? publicKey : null;
}

type Registered = { ok: true; devices: number; registered: boolean; elsewhere: boolean } | { ok: false; reason: string };

async function register(sub: PushSubscription, extra: { sync?: boolean; replaces?: string } = {}): Promise<Registered> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent, installed: isStandalone(), ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: data?.error || "Couldn't register this device." };
  return { ok: true, devices: data.devices ?? 1, registered: data.registered !== false, elsewhere: data.elsewhere === true };
}

/**
 * This browser's subscription, made with the site's current key. One made
 * with an older key is thrown away and made again: the browser would keep
 * handing it back, and the push service refuses every message for it (FCM
 * answers 403 forever), so a phone that "has notifications on" gets nothing.
 */
async function freshSubscription(
  reg: ServiceWorkerRegistration,
  publicKey: string,
  opts: { forceNew?: boolean } = {}
): Promise<{ sub: PushSubscription; replaced?: string }> {
  const existing = await reg.pushManager.getSubscription();
  if (existing && !opts.forceNew && sameApplicationServerKey(existing.options?.applicationServerKey, publicKey)) {
    return { sub: existing };
  }
  const replaced = existing?.endpoint;
  if (existing) await existing.unsubscribe().catch(() => undefined);
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey) as BufferSource,
  });
  return { sub, replaced: replaced && replaced !== sub.endpoint ? replaced : undefined };
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
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    const publicKey = await currentPublicKey();
    if (!publicKey) return { ok: false, reason: "Push notifications aren't set up on this site yet." };
    const { sub, replaced } = await freshSubscription(reg, publicKey);
    const r = await register(sub, replaced ? { replaces: replaced } : {});
    if (!r.ok) return r;
    return { ok: true, devices: r.devices };
  } catch (err) {
    console.error("enablePush", err);
    return { ok: false, reason: "Couldn't turn notifications on. On an iPhone, open the site from your home screen first." };
  }
}

export type SyncResult = { state: PushState; note?: string };

/**
 * Run when the settings page opens: makes what it shows true. The browser
 * saying "subscribed" isn't enough — the subscription may have been made
 * with an old key, or the server may have removed it after the push
 * service said it was gone. With permission already granted, both are
 * repaired here without a tap (Chrome allows subscribing then); anything
 * else shows "off" so the Enable button is there.
 */
export async function syncPush(): Promise<SyncResult> {
  if (!pushSupported()) return { state: "unsupported" };
  if (Notification.permission === "denied") return { state: "denied" };
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const existing = await reg?.pushManager.getSubscription();
    if (!reg || !existing) return { state: "off" };
    // Picks up a new sw.js now rather than whenever the browser gets round to it.
    reg.update().catch(() => undefined);
    if (Notification.permission !== "granted") return { state: "off" };
    const publicKey = await currentPublicKey();
    if (!publicKey) return { state: "off", note: "Push notifications aren't set up on this site yet." };

    const { sub, replaced } = await freshSubscription(reg, publicKey);
    if (replaced) {
      // It was made with an old key and has just been made again.
      const r = await register(sub, { replaces: replaced });
      if (!r.ok) return { state: "off", note: r.reason };
      return { state: "on", note: "This device was registered with an old key; it's been renewed." };
    }
    const r = await register(sub, { sync: true });
    if (!r.ok) return { state: "off", note: r.reason };
    if (r.registered) return { state: "on" };
    // Another login on this phone has it: it's theirs until someone taps Enable here.
    if (r.elsewhere) return { state: "off" };
    // The server has no row for it — usually because the push service said
    // this endpoint was gone — so a new one is made rather than sending the
    // dead one back.
    const renewed = await freshSubscription(reg, publicKey, { forceNew: true });
    const again = await register(renewed.sub, renewed.replaced ? { replaces: renewed.replaced } : {});
    if (!again.ok) return { state: "off", note: again.reason };
    return { state: "on", note: "This device's registration had lapsed; it's been renewed." };
  } catch (err) {
    console.error("syncPush", err);
    return { state: await pushState().catch(() => "off" as PushState) };
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

type TestReport = {
  devices?: number;
  sent?: number;
  unconfigured?: boolean;
  results?: { device: string; sent: boolean; error?: string; removed?: boolean }[];
};

export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/push/test", { method: "POST" });
  const r = (await res.json().catch(() => ({}))) as TestReport & { error?: string };
  if (!res.ok) return { ok: false, message: r?.error || "Couldn't send a test." };
  if (r.unconfigured) return { ok: false, message: "Push notifications aren't set up on this site yet (VAPID keys)." };
  if (!r.devices) return { ok: false, message: "None of your devices has notifications on yet." };
  const failed = (r.results ?? []).filter((x) => !x.sent);
  const why = failed.map((x) => `${x.device}: ${x.error ?? "not sent"}`).join(" ");
  const sent = r.sent ?? 0;
  if (sent > 0) {
    const head = `Sent to ${sent} of your ${r.devices} device${r.devices === 1 ? "" : "s"}. It should appear in a moment.`;
    return { ok: true, message: failed.length ? `${head} ${why}` : head };
  }
  return { ok: false, message: why || "The push service refused it." };
}
