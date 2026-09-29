import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOTTOM_ZONE,
  HIDE_THRESHOLD,
  TOP_ZONE,
  centeredScrollLeft,
  edgeFades,
  initialBarState,
  nextBarState,
  type BarScrollState,
} from "../lib/nav-scroll.ts";

const page = { viewport: 800, content: 4000 }; // maxY = 3200

/** Run a sequence of scroll positions through the decision, like frames. */
function run(ys: number[], start: BarScrollState = initialBarState(ys[0])): BarScrollState {
  return ys.reduce((s, y) => nextBarState(s, { y, ...page }), start);
}

test("the bar starts shown", () => {
  assert.equal(initialBarState().visible, true);
});

test("scrolling down past the threshold hides it", () => {
  const s = run([200, 200 + HIDE_THRESHOLD + 1]);
  assert.equal(s.visible, false);
});

test("a few pixels of jitter do not hide it", () => {
  const s = run([300, 304, 301, 306, 303, 300 + HIDE_THRESHOLD]);
  assert.equal(s.visible, true);
});

test("jitter while hidden does not bring it back", () => {
  const hidden = run([300, 500]);
  assert.equal(hidden.visible, false);
  const s = run([496, 500, 494, 500 - HIDE_THRESHOLD], hidden);
  assert.equal(s.visible, false);
});

test("scrolling up past the threshold shows it again", () => {
  const hidden = run([300, 900]);
  const s = run([880, 900 - HIDE_THRESHOLD - 1], hidden);
  assert.equal(s.visible, true);
});

test("the threshold counts from the furthest point, not the last frame", () => {
  // Slow scroll in 5px steps still hides once the total passes the threshold.
  const down = run([300, 305, 310, 315]);
  assert.equal(down.visible, false);
  // And after going further down, coming up is measured from the new low point.
  const further = run([400, 1200], down);
  assert.equal(run([1195, 1190], further).visible, false);
  assert.equal(run([1195, 1190, 1180], further).visible, true);
});

test("it never hides near the top", () => {
  assert.equal(run([0, TOP_ZONE]).visible, true);
  assert.equal(run([TOP_ZONE - 1, TOP_ZONE]).visible, true);
});

test("an iOS bounce above the top shows it", () => {
  const hidden = run([300, 900]);
  assert.equal(run([-30], hidden).visible, true);
});

test("reaching the bottom shows it", () => {
  const hidden = run([300, 2000]);
  assert.equal(hidden.visible, false);
  assert.equal(run([3200 - BOTTOM_ZONE], hidden).visible, true);
  // Including the overscroll bounce past the end.
  assert.equal(run([3260], hidden).visible, true);
});

test("a page too short to scroll always shows it", () => {
  const s = nextBarState({ visible: false, anchorY: 0 }, { y: 0, viewport: 800, content: 790 });
  assert.equal(s.visible, true);
});

test("options override the defaults", () => {
  const s = nextBarState(initialBarState(100), { y: 104, ...page }, { threshold: 3, topZone: 0 });
  assert.equal(s.visible, false);
});

test("no fade when every tab fits", () => {
  assert.deepEqual(edgeFades(0, 390, 390), { start: false, end: false });
  assert.deepEqual(edgeFades(0, 391, 390), { start: false, end: false });
});

test("at the start only the end fades", () => {
  assert.deepEqual(edgeFades(0, 612, 378), { start: false, end: true });
  assert.deepEqual(edgeFades(1.5, 612, 378), { start: false, end: true });
});

test("in the middle both edges fade", () => {
  assert.deepEqual(edgeFades(100, 612, 378), { start: true, end: true });
});

test("at the end only the start fades", () => {
  assert.deepEqual(edgeFades(234, 612, 378), { start: true, end: false });
  assert.deepEqual(edgeFades(233.4, 612, 378), { start: true, end: false });
});

test("right-to-left scroll positions are read by distance", () => {
  assert.deepEqual(edgeFades(-234, 612, 378), { start: true, end: false });
});

test("the active tab is centred, clamped to the row", () => {
  // Row 378 wide, 9 tabs of 68px = 612 wide; max scroll 234.
  assert.equal(centeredScrollLeft(0, 68, 378, 612), 0);
  assert.equal(centeredScrollLeft(272, 68, 378, 612), 117);
  assert.equal(centeredScrollLeft(544, 68, 378, 612), 234);
  // Nothing to scroll.
  assert.equal(centeredScrollLeft(200, 68, 400, 380), 0);
});
