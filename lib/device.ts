/**
 * What kind of phone a visitor is holding, from the user agent — enough to
 * show the right "install this" steps, and nothing more precise than that.
 */
export type Device = {
  kind: "ios" | "android" | "desktop";
  /** On iOS only Safari can install a web app; the banner has to say so. */
  browser: "safari" | "chrome" | "other";
};

export function deviceFromUserAgent(ua: string, opts: { touchPoints?: number; platform?: string } = {}): Device {
  const u = ua || "";
  // iPadOS asks for desktop pages and calls itself a Mac; the touch screen gives it away.
  const ios = /iPhone|iPad|iPod/i.test(u) || (/Macintosh/i.test(u) && (opts.touchPoints ?? 0) > 1);
  if (ios) {
    const other = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Brave|FBAN|FBAV|Instagram|Line\/|Snapchat|GSA\//i.test(u);
    return { kind: "ios", browser: other || !/Safari/i.test(u) ? "other" : "safari" };
  }
  if (/Android/i.test(u)) {
    const chrome = /Chrome\//i.test(u) && !/EdgA|OPR|SamsungBrowser|Firefox|FB_IAB|FBAN|Instagram|Line\//i.test(u);
    return { kind: "android", browser: chrome ? "chrome" : "other" };
  }
  return { kind: "desktop", browser: /Chrome\//i.test(u) ? "chrome" : /Safari/i.test(u) ? "safari" : "other" };
}

/** How long a dismissed banner stays away. */
export const BANNER_SNOOZE_DAYS = 30;

export function snoozed(dismissedAt: string | null | undefined, now = Date.now()): boolean {
  if (!dismissedAt) return false;
  const t = Number(dismissedAt);
  if (!Number.isFinite(t)) return false;
  return now - t < BANNER_SNOOZE_DAYS * 86_400_000;
}
