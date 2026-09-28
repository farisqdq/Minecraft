import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPdf, jpegInfo, type JpegPage } from "../lib/pdf.ts";

/** A JPEG's header up to the frame marker — enough for the size reader, and what the writer embeds as-is. */
function fakeJpeg(width: number, height: number, components: 1 | 3, extra = 0): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const body = new Uint8Array(extra).fill(0x5a);
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...body, 0xff, 0xd9]);
}

const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

test("the size and colour depth are read from the frame header", () => {
  assert.deepEqual(jpegInfo(fakeJpeg(1275, 1650, 3)), { width: 1275, height: 1650, components: 3 });
  assert.deepEqual(jpegInfo(fakeJpeg(600, 800, 1)), { width: 600, height: 800, components: 1 });
  assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null, "a PNG is not a JPEG");
  assert.equal(jpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), null, "image data with no frame header");
});

test("one page per image, in the order given, sized at 150 dpi", () => {
  const pages: JpegPage[] = [
    { data: fakeJpeg(1275, 1650, 3), width: 1275, height: 1650, components: 3 },
    { data: fakeJpeg(1650, 1275, 1), width: 1650, height: 1275, components: 1 },
  ];
  const pdf = text(buildPdf(pages, { title: "Lease – 12 Elm St", created: new Date("2026-09-28T12:00:00Z") }));
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 2);
  assert.match(pdf, /\/Count 2/);
  // Letter portrait, then landscape, in points.
  assert.match(pdf, /\/MediaBox \[0 0 612 792\]/);
  assert.match(pdf, /\/MediaBox \[0 0 792 612\]/);
  assert.match(pdf, /\/ColorSpace \/DeviceRGB/);
  assert.match(pdf, /\/ColorSpace \/DeviceGray/);
  assert.match(pdf, /\/Filter \/DCTDecode/);
  assert.match(pdf, /\/CreationDate \(D:20260928120000Z\)/);
  // A non-ASCII title is written as UTF-16.
  assert.match(pdf, /\/Title <FEFF/);
  assert.match(pdf, /%%EOF\n$/);
});

test("the cross-reference table points at every object", () => {
  const pages: JpegPage[] = [{ data: fakeJpeg(100, 50, 3, 1000), width: 100, height: 50, components: 3 }];
  const bytes = buildPdf(pages);
  const pdf = text(bytes);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const entries = pdf.slice(startxref).split("\n").filter((l) => /^\d{10} 00000 n $/.test(l));
  assert.equal(entries.length, 6, "catalog, pages, info, page, image, content");
  entries.forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    assert.equal(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`);
  });
});

test("the JPEG bytes are embedded untouched, with the length the reader expects", () => {
  const jpeg = fakeJpeg(100, 50, 3, 500);
  const bytes = buildPdf([{ data: jpeg, width: 100, height: 50, components: 3 }]);
  const pdf = text(bytes);
  const at = pdf.indexOf("/Length " + jpeg.length + " >>\nstream\n") + ("/Length " + jpeg.length + " >>\nstream\n").length;
  assert.ok(at > 20);
  assert.deepEqual(bytes.slice(at, at + jpeg.length), jpeg);
});

test("a PDF with no pages is refused", () => {
  assert.throws(() => buildPdf([]));
});
