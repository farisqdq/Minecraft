/**
 * The decisions behind the phone tab bar, kept free of the DOM so they can be
 * tested: when a vertical scroll should tuck the bar away or bring it back,
 * which edges of the swipeable tab row should fade, and where to scroll the
 * row so the current tab sits in the middle.
 */

/** How far (px) the page must travel in one direction before the bar reacts,
 *  so a finger resting on the glass or momentum jitter doesn't flicker it. */
export const HIDE_THRESHOLD = 12;

/** Near the top the bar always shows: there is nothing to make room for yet,
 *  and a rubber-band bounce (negative scrollY on iOS) must not hide it. */
export const TOP_ZONE = 64;

/** At the bottom of the page the bar comes back, since the person has
 *  finished reading and the next thing they do is go somewhere else. */
export const BOTTOM_ZONE = 24;

export type BarScrollState = {
  visible: boolean;
  /** Where the current run of scrolling started: the lowest point reached
   *  while visible, or the highest point reached while hidden. */
  anchorY: number;
};

export type ScrollMetrics = {
  /** window.scrollY — may be negative or past the end during an iOS bounce. */
  y: number;
  /** The visible height (window.innerHeight). */
  viewport: number;
  /** The full scrollable height (document.documentElement.scrollHeight). */
  content: number;
};

export type BarScrollOptions = {
  threshold?: number;
  topZone?: number;
  bottomZone?: number;
};

export function initialBarState(y = 0): BarScrollState {
  return { visible: true, anchorY: y };
}

/**
 * Next visibility for the bar given where the page is now. Pure: feed it the
 * previous state and the current metrics, keep what it returns.
 *
 * - Near the top, at the bottom, or on a page too short to scroll: shown.
 * - While shown, it hides once the page has moved down `threshold` px past
 *   the lowest point it was last scrolled up to.
 * - While hidden, it shows once the page has moved up `threshold` px from
 *   the furthest point it was scrolled down to.
 */
export function nextBarState(
  prev: BarScrollState,
  { y, viewport, content }: ScrollMetrics,
  { threshold = HIDE_THRESHOLD, topZone = TOP_ZONE, bottomZone = BOTTOM_ZONE }: BarScrollOptions = {},
): BarScrollState {
  const maxY = Math.max(0, content - viewport);
  if (maxY <= 0 || y <= topZone || y >= maxY - bottomZone) {
    return { visible: true, anchorY: y };
  }
  if (prev.visible) {
    // Scrolling up while shown just moves the starting line with it.
    if (y <= prev.anchorY) return { visible: true, anchorY: y };
    if (y - prev.anchorY > threshold) return { visible: false, anchorY: y };
    return prev;
  }
  if (y >= prev.anchorY) return { visible: false, anchorY: y };
  if (prev.anchorY - y > threshold) return { visible: true, anchorY: y };
  return prev;
}

/** Which ends of the tab row have more tabs past them. */
export type EdgeFades = { start: boolean; end: boolean };

/**
 * Fade an edge only when there is something to scroll to on that side.
 * `slack` absorbs sub-pixel scroll positions (a zoomed or 3x screen rarely
 * lands exactly on 0 or on the end).
 */
export function edgeFades(scrollLeft: number, scrollWidth: number, clientWidth: number, slack = 2): EdgeFades {
  const max = scrollWidth - clientWidth;
  if (max <= slack) return { start: false, end: false };
  // Right-to-left layouts report negative scrollLeft; the distance is what matters.
  const left = Math.abs(scrollLeft);
  return { start: left > slack, end: left < max - slack };
}

/**
 * The scrollLeft that puts a tab in the middle of the row, clamped to what
 * the row can actually scroll. Used instead of scrollIntoView, which can
 * also scroll the page vertically to bring the fixed bar "into view".
 */
export function centeredScrollLeft(tabLeft: number, tabWidth: number, clientWidth: number, scrollWidth: number): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  const target = tabLeft + tabWidth / 2 - clientWidth / 2;
  return Math.round(Math.min(max, Math.max(0, target)));
}
