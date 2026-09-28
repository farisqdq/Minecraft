import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptiveThreshold,
  contrastTable,
  exifOrientation,
  borderMedian,
  findPaper,
  pageBudget,
  percentile,
  rotationFor,
  toGray,
} from "../lib/scan.ts";

/** A dark desk with a bright sheet of paper on it. */
function desk(width: number, height: number, paper: { x: number; y: number; w: number; h: number }, ink?: (x: number, y: number) => boolean) {
  const gray = new Uint8Array(width * height).fill(40);
  for (let y = paper.y; y < paper.y + paper.h; y++) {
    for (let x = paper.x; x < paper.x + paper.w; x++) gray[y * width + x] = ink?.(x, y) ? 30 : 220;
  }
  return gray;
}

test("grey is the perceived brightness of the colour", () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  assert.deepEqual([...toGray(rgba, 3, 1)], [255, 0, 76]);
});

test("the desk is what's round the edge, the paper is the brightest large thing", () => {
  const gray = desk(100, 100, { x: 20, y: 20, w: 60, h: 60 });
  assert.equal(borderMedian(gray, 100, 100), 40);
  assert.equal(percentile(gray, 0.95), 220);
});

test("a shadow across half the page doesn't cut the crop in half", () => {
  // Lit paper 220, shadowed paper 110 (half as bright), desk 75 — brown wood.
  const gray = new Uint8Array(200 * 300).fill(75);
  for (let y = 60; y < 240; y++) for (let x = 40; x < 160; x++) gray[y * 200 + x] = x < 100 ? 220 : 110;
  const box = findPaper(gray, 200, 300)!;
  assert.ok(box, "found");
  assert.ok(box.x + box.width >= 158 && box.x + box.width <= 160, `right edge ${box.x + box.width}`);
});

test("the paper's edges are found, and the crop comes in a touch from them", () => {
  const box = findPaper(desk(200, 300, { x: 40, y: 60, w: 120, h: 180 }), 200, 300)!;
  assert.ok(box);
  assert.ok(box.x >= 40 && box.x <= 42, `x ${box.x}`);
  assert.ok(box.y >= 60 && box.y <= 62, `y ${box.y}`);
  assert.ok(box.x + box.width <= 160 && box.x + box.width >= 158);
  assert.ok(box.y + box.height <= 240 && box.y + box.height >= 238);
});

test("a thumb at the edge doesn't move the crop", () => {
  // Paper plus a dark blob overlapping its left edge: rows still count as
  // paper because most of each row is bright.
  const gray = desk(200, 300, { x: 40, y: 60, w: 120, h: 180 });
  for (let y = 100; y < 140; y++) for (let x = 40; x < 70; x++) gray[y * 200 + x] = 35;
  const box = findPaper(gray, 200, 300)!;
  assert.ok(box.x >= 40 && box.x <= 42);
});

test("a photo that is all paper, or hardly any, isn't cropped", () => {
  assert.equal(findPaper(desk(100, 100, { x: 0, y: 0, w: 100, h: 100 }), 100, 100), null);
  assert.equal(findPaper(desk(100, 100, { x: 45, y: 45, w: 10, h: 10 }), 100, 100), null);
});

test("contrast stretch turns grey paper white and faint ink black", () => {
  const gray = new Uint8Array(10000);
  for (let i = 0; i < gray.length; i++) gray[i] = i % 50 === 0 ? 90 : 170; // 2% ink at 90, paper at 170
  const table = contrastTable(gray);
  assert.equal(table[170], 255);
  assert.equal(table[90], 0);
  assert.ok(table[130] > 0 && table[130] < 255);
});

test("blank paper stays paper: a near-uniform page isn't stretched into noise", () => {
  // Paper at 203 with a few specks of ink — the 2nd and 98th percentiles
  // are both 203. Stretching that to the full range would map 203 to 0.
  const gray = new Uint8Array(10000).fill(203);
  for (let i = 0; i < 20; i++) gray[i * 500] = 30;
  const table = contrastTable(gray);
  assert.equal(table[203], 255);
  assert.equal(table[30], 0);
  assert.ok(table[200] > 230, `a shade darker than the paper stays nearly white, got ${table[200]}`);
});

test("the adaptive threshold keeps ink under a shadow", () => {
  // Left half lit (paper 220, ink 120), right half in shadow (paper 120, ink 40).
  const w = 120;
  const h = 40;
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const shadow = x >= 60;
      const ink = y >= 18 && y < 22 && x % 20 < 10;
      gray[y * w + x] = shadow ? (ink ? 40 : 120) : ink ? 120 : 220;
    }
  }
  const bw = adaptiveThreshold(gray, w, h, 8, 10);
  assert.equal(bw[20 * w + 25], 0, "lit ink is black");
  assert.equal(bw[20 * w + 105], 0, "shadowed ink is black too");
  assert.equal(bw[5 * w + 20], 255, "lit paper is white");
  assert.equal(bw[5 * w + 100], 255, "shadowed paper is white, not black");
});

/** A JPEG with an EXIF APP1 segment carrying one orientation tag. */
function jpegWithOrientation(value: number, little = false): Uint8Array {
  const tiff = little
    ? [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, value, 0, 0, 0]
    : [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...payload, 0xff, 0xda, 0, 2]);
}

test("the EXIF orientation is read in either byte order, and absent means upright", () => {
  assert.equal(exifOrientation(jpegWithOrientation(6)), 6);
  assert.equal(exifOrientation(jpegWithOrientation(8, true)), 8);
  assert.equal(exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1);
  assert.equal(exifOrientation(new Uint8Array([0x89, 0x50])), 1);
  assert.equal(rotationFor(6), 90);
  assert.equal(rotationFor(8), 270);
  assert.equal(rotationFor(3), 180);
  assert.equal(rotationFor(1), 0);
});

test("the per-page byte budget divides the upload cap", () => {
  assert.equal(pageBudget(1), Math.floor(3.9 * 1024 * 1024));
  assert.equal(pageBudget(10), Math.floor((3.9 * 1024 * 1024) / 10));
  assert.equal(pageBudget(0), Math.floor(3.9 * 1024 * 1024));
});
