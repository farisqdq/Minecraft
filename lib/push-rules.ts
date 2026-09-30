/**
 * The rules around push notifications that need no browser, no database and
 * no network: comparing keys, naming devices, checking links, and turning a
 * push service's answer into words. Pure, so tests/push-rules.test.ts can
 * pin each one down.
 */

/** base64url (as VAPID keys are written) to bytes. Whitespace a pasted env var picked up is ignored. */
export function base64UrlToBytes(base64url: string): Uint8Array {
  const clean = (base64url || "").replace(/\s+/g, "").replace(/=+$/, "");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Whether a browser subscription was made with this site's current public
 * key. A subscription made with an older key can never receive anything:
 * the push service refuses every message signed with the new key (FCM with
 * a 403), and the browser keeps handing back the same dead subscription
 * until it is thrown away and made again. A missing key counts as
 * different — there's no way to know it matches.
 */
export function sameApplicationServerKey(
  subscriptionKey: ArrayBuffer | ArrayBufferView | null | undefined,
  currentPublicKey: string
): boolean {
  if (!subscriptionKey || !currentPublicKey) return false;
  const a = ArrayBuffer.isView(subscriptionKey)
    ? new Uint8Array(subscriptionKey.buffer, subscriptionKey.byteOffset, subscriptionKey.byteLength)
    : new Uint8Array(subscriptionKey);
  let b: Uint8Array;
  try {
    b = base64UrlToBytes(currentPublicKey);
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * "Android · Chrome", "iPhone · Safari (installed app)" — enough for an
 * admin to tell a landlord's laptop from their dad's phone. The installed
 * part is only known when the phone said so when it registered.
 */
export function describeDevice(userAgent: string | null | undefined, opts: { installed?: boolean } = {}): string {
  const raw = userAgent || "";
  // app/api/push/subscribe marks a device registered from the home-screen app.
  const marked = /\s*\[installed\]\s*$/.test(raw);
  const u = raw.replace(/\s*\[installed\]\s*$/, "");
  const installed = opts.installed || marked;
  if (!u.trim()) return "Unknown device";
  let os = "";
  if (/iPad/i.test(u)) os = "iPad";
  else if (/iPhone|iPod/i.test(u)) os = "iPhone";
  else if (/Android/i.test(u)) os = "Android";
  else if (/Windows/i.test(u)) os = "Windows";
  else if (/CrOS/i.test(u)) os = "Chromebook";
  else if (/Macintosh|Mac OS X/i.test(u)) os = "Mac";
  else if (/Linux/i.test(u)) os = "Linux";

  let browser = "";
  if (/SamsungBrowser/i.test(u)) browser = "Samsung Internet";
  else if (/EdgA?\/|EdgiOS/i.test(u)) browser = "Edge";
  else if (/OPR\/|OPiOS|Opera/i.test(u)) browser = "Opera";
  else if (/Firefox|FxiOS/i.test(u)) browser = "Firefox";
  else if (/CriOS/i.test(u)) browser = "Chrome";
  else if (/Chrome\//i.test(u)) browser = "Chrome";
  else if (/Safari/i.test(u) || os === "iPhone" || os === "iPad") browser = "Safari";

  if (!os && !browser) return "Unknown device";
  const parts = [os || "Unknown system", browser || "unknown browser"].join(" · ");
  return installed ? `${parts} (installed app)` : parts;
}

/** Which company runs the push service an endpoint belongs to — the first thing to know when one refuses. */
export function pushServiceName(endpoint: string): string {
  let host = "";
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return "unknown push service";
  }
  if (/(^|\.)googleapis\.com$/.test(host)) return "Google (FCM)";
  if (/(^|\.)push\.apple\.com$/.test(host)) return "Apple";
  if (/(^|\.)mozilla\.com$|(^|\.)mozaws\.net$/.test(host)) return "Mozilla";
  if (/(^|\.)notify\.windows\.com$/.test(host)) return "Microsoft";
  return host;
}

export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 300;
export const PUSH_LINK_MAX = 500;

export type ComposeCheck = { ok: true; title: string; body: string; link: string } | { ok: false; error: string };

/**
 * A link a notification may open: a path on this site ("/dashboard/…") or
 * a full https address. Nothing else — no "javascript:", no "//other.site"
 * that only looks like a path, no plain http.
 */
export function checkPushLink(raw: string): { ok: true; link: string } | { ok: false; error: string } {
  const link = (raw || "").trim();
  if (!link) return { ok: true, link: "" };
  if (link.length > PUSH_LINK_MAX) return { ok: false, error: `Keep the link under ${PUSH_LINK_MAX} characters.` };
  if (/\s/.test(link)) return { ok: false, error: "A link can't have spaces in it." };
  if (link.startsWith("/")) {
    if (link.startsWith("//") || link.startsWith("/\\")) return { ok: false, error: "Start the link with a single / (like /dashboard) or https://." };
    return { ok: true, link };
  }
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { ok: false, error: "The link must be a page on this site (like /dashboard) or start with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The link must be a page on this site (like /dashboard) or start with https://." };
  return { ok: true, link: url.href };
}

/** The title, message and link an admin typed, trimmed and within bounds. */
export function checkCompose(input: { title?: unknown; body?: unknown; link?: unknown }): ComposeCheck {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const rawLink = typeof input.link === "string" ? input.link : "";
  if (!title) return { ok: false, error: "Give the notification a title." };
  if (title.length > PUSH_TITLE_MAX) return { ok: false, error: `Keep the title under ${PUSH_TITLE_MAX} characters.` };
  if (!body) return { ok: false, error: "Write a message." };
  if (body.length > PUSH_BODY_MAX) return { ok: false, error: `Keep the message under ${PUSH_BODY_MAX} characters.` };
  const l = checkPushLink(rawLink);
  if (!l.ok) return l;
  return { ok: true, title, body, link: l.link };
}

/**
 * What a push service's refusal means, in words an admin can act on, with
 * the status code in it. `detail` is the service's own reply (or, with no
 * status, the error thrown before anything was sent), trimmed to a snippet.
 */
export function pushFailureMessage(status: number | undefined, detail?: string | null): string {
  const snippet = (detail || "").replace(/\s+/g, " ").trim().slice(0, 140).replace(/[.\s]+$/, "");
  const tail = snippet ? ` (${snippet})` : "";
  if (!status) {
    return snippet ? `Not sent: ${snippet}` : "Not sent: the push service couldn't be reached.";
  }
  switch (status) {
    case 400:
      return `400 — the push service rejected the message as malformed${tail}.`;
    case 401:
    case 403:
      // Apple says BadJwtToken (and FCM "invalid JWT") when the site's own
      // signature is wrong — every device fails alike, and re-subscribing
      // the phone won't help. Anything else here is the old-key case.
      if (/BadJwtToken|ExpiredProviderToken|invalid jwt|jwt.*(invalid|expired)|subject/i.test(snippet)) {
        return `${status} — the push service refused this site's signature: check VAPID_SUBJECT (mailto: or https:) and the VAPID keys${tail}.`;
      }
      return `${status} — this device subscribed with an old key. Turn notifications off and on again on that device${tail}.`;
    case 404:
    case 410:
      return `${status} — this device has unsubscribed or expired; it's been removed. Turn notifications on again on that device${tail}.`;
    case 413:
      return `413 — the message is too long for the push service${tail}.`;
    case 429:
      return `429 — the push service says too many messages; try again later${tail}.`;
    default:
      if (status >= 500) return `${status} — the push service had a problem; try again later${tail}.`;
      return `${status} — the push service refused it${tail}.`;
  }
}

/** Whether a failed send means the subscription is dead and its row should go. */
export function pushIsGone(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

export type PushTarget = { kind: "device"; id: string } | { kind: "person"; owner: string } | { kind: "everyone" };

/** A device as far as choosing recipients goes: its id and whose it is ("user:…" or "tenant:…"). */
export type TargetableDevice = { id: string; owner: string };

/** Reads a target out of a request body, or null when it isn't one. */
export function parsePushTarget(raw: unknown): PushTarget | null {
  const t = raw as { kind?: unknown; id?: unknown; owner?: unknown } | null;
  if (!t || typeof t !== "object") return null;
  if (t.kind === "everyone") return { kind: "everyone" };
  if (t.kind === "device" && typeof t.id === "string" && t.id) return { kind: "device", id: t.id };
  if (t.kind === "person" && typeof t.owner === "string" && /^(user|tenant):.+/.test(t.owner)) return { kind: "person", owner: t.owner };
  return null;
}

/** The devices a target reaches. */
export function selectTargets<T extends TargetableDevice>(devices: T[], target: PushTarget): T[] {
  switch (target.kind) {
    case "everyone":
      return devices;
    case "device":
      return devices.filter((d) => d.id === target.id);
    case "person":
      return devices.filter((d) => d.owner === target.owner);
  }
}

/**
 * Ten sends per admin in fifteen minutes is plenty for testing a phone;
 * three of them to everyone at once, because each one buzzes every tenant's
 * pocket. The ceiling is what stops a slipped finger (or a stolen admin
 * session) from spamming the whole site.
 */
export const MAX_PUSH_SENDS_PER_ADMIN = 10;
export const MAX_PUSH_BROADCASTS_PER_ADMIN = 3;

/** Throttle keys for lib/throttle.ts, prefixed so they can never collide with sign-in keys. */
export function adminPushKeys(adminId: string, target: PushTarget): { key: string; max: number }[] {
  const keys = [{ key: `admin-push:by:${adminId}`, max: MAX_PUSH_SENDS_PER_ADMIN }];
  if (target.kind === "everyone") keys.push({ key: `admin-push:all:${adminId}`, max: MAX_PUSH_BROADCASTS_PER_ADMIN });
  return keys;
}

export function pushPausedMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `That's enough notifications for now — try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** "3 sent, 1 failed" — for the audit log and the toast. */
export function sendTally(results: { sent: boolean }[]): { sent: number; failed: number; text: string } {
  const sent = results.filter((r) => r.sent).length;
  const failed = results.length - sent;
  return { sent, failed, text: `${sent} sent, ${failed} failed` };
}
