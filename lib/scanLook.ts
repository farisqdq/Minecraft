/**
 * How each scanned page looks, and what that means for its file size.
 *
 * Most of what a landlord scans is paper — a lease, a notice, a receipt —
 * and paper reads best, and weighs least, as black and white. A photo of
 * damage is the exception: the stain has to stay brown. So every page
 * carries its own look, the scanner starts in black and white, and one
 * page at a time can be switched to colour. The "All" chips set every page
 * and the look new pages arrive in.
 *
 * Pure: no canvas, no React, so it's tested in Node.
 */

export type Look = "color" | "bw";

/** What a scan starts in: paper. */
export const DEFAULT_LOOK: Look = "bw";

export function otherLook(look: Look): Look {
  return look === "bw" ? "color" : "bw";
}

/** Short label for a page's own toggle, which shows the look it's in. */
export function lookLabel(look: Look): string {
  return look === "bw" ? "B&W" : "Color";
}

/**
 * The look every page shares, or null when they differ (so neither "All"
 * chip lights up) — and, with no pages yet, the look new ones will get.
 */
export function sharedLook(pages: readonly { look: Look }[], fallback: Look): Look | null {
  if (pages.length === 0) return fallback;
  const first = pages[0].look;
  return pages.every((p) => p.look === first) ? first : null;
}

/** Every page in `look`; pages already in it are returned as they were. */
export function withEveryLook<T extends { look: Look }>(pages: readonly T[], look: Look): T[] {
  return pages.map((p) => (p.look === look ? p : { ...p, look }));
}

/**
 * JPEG quality a page is first encoded at. A black-and-white page is two
 * flat tones and hard edges: at 0.6 the letters are still clean and the
 * file is a fraction of the size. A colour page keeps 0.85 so a photo of
 * damage stays a photo.
 */
export function firstQuality(look: Look): number {
  return look === "bw" ? 0.6 : 0.85;
}

/**
 * Qualities to step down through when a page is over its share of the
 * upload cap. There's no point re-trying a black-and-white page above the
 * quality it was made at — that only makes it bigger.
 */
export function qualitySteps(look: Look, steps: readonly number[]): number[] {
  const start = firstQuality(look);
  const below = steps.filter((q) => q <= start + 1e-9);
  return below.length ? below : [Math.min(...steps)];
}
