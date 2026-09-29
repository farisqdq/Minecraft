import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOOK,
  firstQuality,
  lookLabel,
  otherLook,
  qualitySteps,
  sharedLook,
  withEveryLook,
  type Look,
} from "../lib/scanLook.ts";
import { QUALITY_STEPS, adaptiveThreshold, bwParams, softenEdges } from "../lib/scan.ts";

type P = { key: number; look: Look; turns: number };

test("a scan starts in black and white", () => {
  assert.equal(DEFAULT_LOOK, "bw");
});

test("a page's toggle flips it and names the look it's in", () => {
  assert.equal(otherLook("bw"), "color");
  assert.equal(otherLook("color"), "bw");
  assert.equal(lookLabel("bw"), "B&W");
  assert.equal(lookLabel("color"), "Color");
});

test("the All chips light up only when every page agrees", () => {
  assert.equal(sharedLook([], "bw"), "bw", "no pages: the look new ones will get");
  assert.equal(sharedLook([], "color"), "color");
  assert.equal(sharedLook([{ look: "bw" }, { look: "bw" }], "color"), "bw");
  assert.equal(sharedLook([{ look: "bw" }, { look: "color" }], "bw"), null, "mixed: neither chip");
});

test("All B&W switches every page and leaves the rest of each page alone", () => {
  const pages: P[] = [
    { key: 1, look: "bw", turns: 0 },
    { key: 2, look: "color", turns: 1 },
  ];
  const out = withEveryLook(pages, "bw");
  assert.deepEqual(out, [
    { key: 1, look: "bw", turns: 0 },
    { key: 2, look: "bw", turns: 1 },
  ]);
  assert.equal(out[0], pages[0], "a page already in the look is the same object — nothing to redo");
  assert.notEqual(out[1], pages[1]);
});

test("a black-and-white page is encoded lower than colour, and only shrinks from there", () => {
  assert.equal(firstQuality("bw"), 0.6);
  assert.equal(firstQuality("color"), 0.85);
  assert.deepEqual(qualitySteps("bw", QUALITY_STEPS), [0.6, 0.5, 0.4]);
  assert.deepEqual(qualitySteps("color", QUALITY_STEPS), QUALITY_STEPS);
  assert.deepEqual(qualitySteps("bw", [0.9, 0.8]), [0.8], "never an empty list");
});

test("the threshold block is about a line of text at scanning size", () => {
  assert.deepEqual(bwParams(1391, 1800), { radius: 25, offset: 12 });
  assert.deepEqual(bwParams(1800, 1391), { radius: 25, offset: 12 });
  assert.equal(bwParams(300, 400).radius, 8, "a tiny page still gets a usable block");
});

/**
 * A 1800px letter page as a phone sees it: paper ~215 with sensor grain,
 * lines of 12pt-ish text (strokes ~3px, ink ~60), a bold heading, and a
 * soft shadow over the right half that halves the light.
 */
function phonePage() {
  const w = 1391;
  const h = 1800;
  const gray = new Uint8Array(w * h);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 8; // ±4 levels
  };
  const isInk = (x: number, y: number) => {
    // Heading: a solid bold bar-like word, 40px tall.
    if (y >= 120 && y < 160 && x >= 150 && x < 700) return (x - 150) % 60 < 44;
    // Body: lines every 30px, x-height 14px, strokes 3px wide every 9px.
    if (y < 220 || y > 1650 || x < 150 || x > 1240) return false;
    const line = (y - 220) % 30;
    if (line >= 14) return false;
    return (x - 150) % 9 < 3 || line < 2 || line >= 12;
  };
  const light = (x: number) => {
    // Full light left of 640, half light right of 760, a soft edge between.
    const t = Math.min(1, Math.max(0, (x - 640) / 120));
    return 1 - 0.5 * t;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = isInk(x, y) ? 60 : 215;
      gray[y * w + x] = Math.max(0, Math.min(255, Math.round(base * light(x) + noise())));
    }
  }
  return { gray, w, h, isInk };
}

test("on a shadowed phone photo the paper stays white and the text stays black", () => {
  const { gray, w, h, isInk } = phonePage();
  const { radius, offset } = bwParams(w, h);
  const bw = adaptiveThreshold(gray, w, h, radius, offset);
  const tally = { paperLit: [0, 0], paperShadow: [0, 0], inkLit: [0, 0], inkShadow: [0, 0] };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= 600 && x < 800) continue; // the shadow's edge itself
      const key = (isInk(x, y) ? "ink" : "paper") + (x < 700 ? "Lit" : "Shadow");
      const t = tally[key as keyof typeof tally];
      t[0]++;
      if (bw[y * w + x] === (isInk(x, y) ? 0 : 255)) t[1]++;
    }
  }
  const pct = (t: number[]) => t[1] / t[0];
  assert.ok(pct(tally.paperLit) > 0.995, `lit paper white ${pct(tally.paperLit)}`);
  assert.ok(pct(tally.paperShadow) > 0.995, `shadowed paper white ${pct(tally.paperShadow)}`);
  assert.ok(pct(tally.inkLit) > 0.97, `lit ink black ${pct(tally.inkLit)}`);
  assert.ok(pct(tally.inkShadow) > 0.97, `shadowed ink black ${pct(tally.inkShadow)}`);
  // The bold heading doesn't go hollow: its middle is still ink.
  assert.equal(bw[140 * w + 170], 0, "inside a bold word");
});

test("softening leaves paper and solid ink exact and rounds only the edges", () => {
  // A 6x6 page, left half ink, right half paper.
  const w = 6;
  const h = 6;
  const bw = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bw[y * w + x] = x < 3 ? 0 : 255;
  const soft = softenEdges(bw, w, h);
  for (let y = 0; y < h; y++) {
    assert.equal(soft[y * w + 0], 0, "solid ink stays black");
    assert.equal(soft[y * w + 5], 255, "paper stays white");
    assert.equal(soft[y * w + 2], 64, "last ink column picks up a quarter of the paper");
    assert.equal(soft[y * w + 3], 191, "first paper column picks up a quarter of the ink");
  }
  assert.deepEqual([...softenEdges(new Uint8Array(9).fill(255), 3, 3)], new Array(9).fill(255));
});
