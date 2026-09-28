/**
 * Builds a PDF out of JPEG pages — a scanned document.
 *
 * A PDF can carry a JPEG as-is: the page draws an image object whose data
 * is the JPEG's own bytes with the DCTDecode filter, so no re-encoding, no
 * library and nothing heavier than string concatenation. This writes that,
 * and only that: one image per page, sized to the page, a cross-reference
 * table with correct offsets, a title. It runs the same in the browser and
 * in Node, which is what lets it be tested without a browser.
 *
 * Pure: bytes in, bytes out.
 */

export type JpegPage = {
  /** The JPEG file's bytes. */
  data: Uint8Array;
  width: number;
  height: number;
  /** 1 for greyscale JPEGs (the black-and-white scan mode), 3 for colour. */
  components: 1 | 3;
};

/**
 * Reads a JPEG's size and colour depth from its frame header. Every JPEG
 * carries an SOFn marker before the image data with exactly this.
 */
export function jpegInfo(data: Uint8Array): { width: number; height: number; components: 1 | 3 } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1];
    // Padding bytes and markers without a length.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = (data[i + 2] << 8) | data[i + 3];
    // SOF0..SOF15, except the ones that are tables (DHT c4, JPG c8, DAC cc).
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (data[i + 5] << 8) | data[i + 6];
      const width = (data[i + 7] << 8) | data[i + 8];
      const components = data[i + 9];
      if (!width || !height || (components !== 1 && components !== 3)) return null;
      return { width, height, components };
    }
    if (marker === 0xda) return null; // Image data began without a frame header.
    i += 2 + length;
  }
  return null;
}

/** Points per pixel: scans are treated as 150 dpi, so a 1275px-wide page is US Letter width. */
const DPI = 150;
const PT_PER_PX = 72 / DPI;

/** PDF strings are Latin-1 in parentheses; anything else is written as a UTF-16 hex string. */
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = "FEFF";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
    } else hex += code.toString(16).padStart(4, "0");
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

/**
 * The document. Pages come out in the order given; each is the size of its
 * image at 150 dpi, so a portrait photo of a letter makes a portrait page.
 */
export function buildPdf(pages: JpegPage[], opts: { title?: string; created?: Date } = {}): Uint8Array {
  if (pages.length === 0) throw new Error("A PDF needs at least one page.");
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: Uint8Array | string) => {
    const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
    parts.push(b);
    length += b.length;
  };
  const obj = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  // Object numbers: 1 catalog, 2 pages, 3 info, then per page: page, image, content.
  const first = 4;
  const pageIds = pages.map((_, i) => first + i * 3);
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  obj(
    3,
    `<< /Producer (Rent Roll) ${opts.title ? `/Title ${pdfString(opts.title)} ` : ""}/CreationDate ${pdfDate(
      opts.created ?? new Date(0)
    )} >>`
  );
  pages.forEach((page, i) => {
    const [pageId, imageId, contentId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const w = +(page.width * PT_PER_PX).toFixed(2);
    const h = +(page.height * PT_PER_PX).toFixed(2);
    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    obj(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /${
        page.components === 1 ? "DeviceGray" : "DeviceRGB"
      } /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>`,
      page.data
    );
    const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`);
    obj(contentId, `<< /Length ${content.length} >>`, content);
  });

  const count = first + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
