/**
 * The arithmetic of making a phone photo look like a scan.
 *
 * Everything here works on plain arrays of pixels so it can be tested in
 * Node; app/components/Scanner.tsx does the canvas work of getting pixels
 * in and out. Four steps, each its own function:
 *
 *  - EXIF orientation, read from the JPEG itself, for browsers that hand
 *    back a photo lying on its side.
 *  - Finding the paper: the page is the big bright thing in the middle of a
 *    photo of a desk. Anything clearly brighter than the desk is paper, and
 *    the bounding box of that (ignoring specks) is where to crop.
 *  - Contrast: stretch so the paper reads white and the ink black.
 *  - Black and white: an adaptive threshold — each pixel against the mean
 *    of its neighbourhood — so a shadow across the page doesn't turn half
 *    of it black, which a single global threshold would.
 */

/** Greyscale from RGBA, the perceived-brightness weights. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114 + 500) / 1000;
  }
  return out;
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Where the paper is, or null when there's no clear sheet to crop to — a
 * photo that is all paper (already tight), or hardly any.
 *
 * The desk is whatever the edges of the photo are (the sheet is in the
 * middle) and the paper is the brightest large thing. A pixel counts as
 * paper when it's clearly brighter than the desk — a low bar on purpose, so
 * a shadow lying across half the page doesn't cut the crop in half.
 *
 * Rows and columns are counted rather than pixels: a row belongs to the
 * page when enough of it is bright, which ignores a pen or a thumb at the
 * edge. The box comes in a touch so the desk at the edge is left out.
 */
export function findPaper(gray: Uint8Array, width: number, height: number): Box | null {
  const desk = borderMedian(gray, width, height);
  const paper = percentile(gray, 0.95);
  // A sheet on a white table, or no sheet: nothing to crop to.
  if (paper - desk < 30) return null;
  const t = desk + Math.max(20, (paper - desk) * 0.2);
  const rowBright = new Uint16Array(height);
  const colBright = new Uint16Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] > t) {
        rowBright[y]++;
        colBright[x]++;
      }
    }
  }
  const rows = extent(rowBright, width * 0.3);
  const cols = extent(colBright, height * 0.3);
  if (!rows || !cols) return null;
  const box = { x: cols[0], y: rows[0], width: cols[1] - cols[0] + 1, height: rows[1] - rows[0] + 1 };
  const area = (box.width * box.height) / (width * height);
  // Nothing worth cropping to: the sheet fills the frame, or it's too small
  // to be the subject.
  if (area > 0.97 || area < 0.2) return null;
  // Come in a touch from the edge found: a sheet's edge in a photo is a soft
  // line of desk-coloured pixels, and half a percent of the page is margin
  // nobody writes on. A scan with no dark frame reads as a scan.
  const inset = Math.round(Math.min(box.width, box.height) * 0.005);
  return { x: box.x + inset, y: box.y + inset, width: box.width - inset * 2, height: box.height - inset * 2 };
}

/** The typical grey level of a frame around the edge of the picture. */
export function borderMedian(gray: Uint8Array, width: number, height: number): number {
  const frame = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = 0; y < height; y++) {
    const edgeRow = y < frame || y >= height - frame;
    for (let x = 0; x < width; x++) {
      if (edgeRow || x < frame || x >= width - frame) {
        hist[gray[y * width + x]]++;
        n++;
      }
    }
  }
  return levelAt(hist, n / 2);
}

/** The grey level below which `fraction` of the pixels fall. */
export function percentile(gray: Uint8Array, fraction: number): number {
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g]++;
  return levelAt(hist, gray.length * fraction);
}

function levelAt(hist: Uint32Array, count: number): number {
  let acc = 0;
  for (let t = 0; t < 256; t++) {
    acc += hist[t];
    if (acc >= count) return t;
  }
  return 255;
}

/** First and last index whose count clears `min`. */
function extent(counts: Uint16Array, min: number): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= min) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? null : [first, last];
}

/**
 * Stretches the grey levels so the 2nd percentile is black and the 98th is
 * white: paper photographed grey comes out white, faint ink comes out dark.
 * Returns the mapping table so it can be applied to each colour channel.
 */
const MIN_SPAN = 60;

export function contrastTable(gray: Uint8Array): Uint8Array {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let t = 0; t < 256; t++) {
    acc += hist[t];
    if (acc >= total * 0.02) {
      lo = t;
      break;
    }
  }
  acc = 0;
  for (let t = 255; t >= 0; t--) {
    acc += hist[t];
    if (acc >= total * 0.02) {
      hi = t;
      break;
    }
  }
  // A page that's nearly all one shade (blank paper, or a photo already
  // cleaned up) has its 2nd and 98th percentiles almost touching; stretching
  // that gap to the full range would turn paper grain into noise and the
  // colour channels into nonsense. Keep at least sixty levels of room below
  // the paper, so the paper still comes out white and the ink still black.
  if (hi - lo < MIN_SPAN) lo = Math.max(0, hi - MIN_SPAN);
  const table = new Uint8Array(256);
  const span = Math.max(1, hi - lo);
  for (let t = 0; t < 256; t++) table[t] = Math.max(0, Math.min(255, Math.round(((t - lo) * 255) / span)));
  return table;
}

/**
 * Black or white per pixel, judged against the mean of the surrounding
 * block. `offset` is how much darker than its surroundings a pixel must be
 * to count as ink; a few levels keeps paper grain white.
 */
export function adaptiveThreshold(gray: Uint8Array, width: number, height: number, radius = 16, offset = 10): Uint8Array {
  // Summed-area table, so each block mean is four lookups whatever the radius.
  const W = width + 1;
  const sat = new Float64Array(W * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += gray[(y - 1) * width + (x - 1)];
      sat[y * W + x] = sat[(y - 1) * W + x] + row;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      out[y * width + x] = gray[y * width + x] < mean - offset ? 0 : 255;
    }
  }
  return out;
}

/**
 * The EXIF orientation tag of a JPEG (1 = as stored, 3 = upside down, 6 =
 * rotate 90° clockwise to view, 8 = rotate 90° anticlockwise), or 1 when
 * there is none.
 */
export function exifOrientation(data: Uint8Array): number {
  if (data.length < 12 || data[0] !== 0xff || data[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < data.length && data[i] === 0xff) {
    const marker = data[i + 1];
    const length = (data[i + 2] << 8) | data[i + 3];
    if (marker === 0xe1 && i + 10 < data.length) {
      const seg = i + 4;
      // "Exif\0\0" then a TIFF header with its own byte order.
      if (data[seg] === 0x45 && data[seg + 1] === 0x78 && data[seg + 2] === 0x69 && data[seg + 3] === 0x66) {
        const tiff = seg + 6;
        const little = data[tiff] === 0x49 && data[tiff + 1] === 0x49;
        const u16 = (p: number) => (little ? data[p] | (data[p + 1] << 8) : (data[p] << 8) | data[p + 1]);
        const u32 = (p: number) =>
          little
            ? (data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) | (data[p + 3] << 24)) >>> 0
            : ((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]) >>> 0;
        const ifd = tiff + u32(tiff + 4);
        if (ifd + 2 > data.length) return 1;
        const entries = u16(ifd);
        for (let e = 0; e < entries; e++) {
          const at = ifd + 2 + e * 12;
          if (at + 12 > data.length) return 1;
          if (u16(at) === 0x0112) {
            const v = u16(at + 8);
            return v >= 1 && v <= 8 ? v : 1;
          }
        }
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    i += 2 + length;
  }
  return 1;
}

/** Whole quarter turns to apply for an orientation tag, and whether it mirrors (which scans never do). */
export function rotationFor(orientation: number): 0 | 90 | 180 | 270 {
  switch (orientation) {
    case 3:
    case 4:
      return 180;
    case 5:
    case 6:
      return 90;
    case 7:
    case 8:
      return 270;
    default:
      return 0;
  }
}

/**
 * How large a page may be sent, and how to get there: the upload cap is
 * 4 MB for the whole document, so a ten-page scan gets about 350 KB a page.
 */
export const MAX_DOCUMENT_BYTES = 3.9 * 1024 * 1024;

export function pageBudget(pageCount: number): number {
  return Math.floor(MAX_DOCUMENT_BYTES / Math.max(1, pageCount));
}

/** Longest edge for a scan: 150 dpi letter is 1650px; a little over keeps small print legible. */
export const SCAN_MAX_EDGE = 1800;

/** JPEG quality to try, from best to worst, until a page fits its budget. */
export const QUALITY_STEPS = [0.8, 0.7, 0.6, 0.5, 0.4];
