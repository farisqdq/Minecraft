import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadHref,
  extensionOf,
  isPlainClick,
  pdfPageScale,
  viewKindFromContentType,
  viewKindOf,
} from "../lib/file-view.ts";

test("the type the page knows decides first", () => {
  assert.equal(viewKindOf({ mime: "application/pdf", name: "photo.jpg" }), "pdf");
  assert.equal(viewKindOf({ mime: "image/png", name: "lease.pdf" }), "image");
  assert.equal(viewKindOf({ mime: "image/heic" }), "image");
  assert.equal(viewKindOf({ mime: "application/pdf; charset=binary" }), "pdf");
  assert.equal(viewKindOf({ mime: "text/csv" }), "other");
});

test("an empty or generic type falls back to the name, then the URL", () => {
  assert.equal(viewKindOf({ mime: "", name: "Lease.PDF" }), "pdf");
  assert.equal(viewKindOf({ mime: "application/octet-stream", name: "IMG_0001.HEIC" }), "image");
  assert.equal(viewKindOf({ name: "notes.docx" }), "other");
  assert.equal(viewKindOf({ url: "/api/owners/statement.pdf?month=2026-09" }), "pdf");
  assert.equal(viewKindOf({ name: "", url: "/api/files/document/abc" }), null, "the server has to say");
  assert.equal(viewKindOf({}), null);
});

test("the server's Content-Type decides when nothing else could", () => {
  assert.equal(viewKindFromContentType("application/pdf"), "pdf");
  assert.equal(viewKindFromContentType("image/jpeg"), "image");
  assert.equal(viewKindFromContentType("application/octet-stream"), "other");
  assert.equal(viewKindFromContentType(null), "other");
});

test("extensions come from the last part of the name only", () => {
  assert.equal(extensionOf("a/b.c/receipt.JPG"), "jpg");
  assert.equal(extensionOf("/x/file.pdf?download=1#p2"), "pdf");
  assert.equal(extensionOf(".hidden"), "");
  assert.equal(extensionOf("noext"), "");
  assert.equal(extensionOf(undefined), "");
});

test("download links ask /api/files for an attachment, once", () => {
  assert.equal(downloadHref("/api/files/document/abc"), "/api/files/document/abc?download=1");
  assert.equal(downloadHref("/api/owners/statement?month=2026-09"), "/api/owners/statement?month=2026-09&download=1");
  assert.equal(downloadHref("/api/files/photo/x?download=1"), "/api/files/photo/x?download=1");
  assert.equal(downloadHref("/api/files/photo/x#top"), "/api/files/photo/x?download=1#top");
});

test("only a plain left click or tap is taken over", () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(isPlainClick(plain), true);
  assert.equal(isPlainClick({ ...plain, button: 1 }), false, "middle click opens a tab");
  assert.equal(isPlainClick({ ...plain, metaKey: true }), false);
  assert.equal(isPlainClick({ ...plain, ctrlKey: true }), false);
  assert.equal(isPlainClick({ ...plain, shiftKey: true }), false);
  assert.equal(isPlainClick({ ...plain, altKey: true }), false);
  assert.equal(isPlainClick({ ...plain, defaultPrevented: true }), false);
});

test("PDF pages fill the width sharply but never past the pixel budget", () => {
  const letter = { width: 612, height: 792 };
  const phone = pdfPageScale(letter, 390, 3);
  assert.equal(phone.cssWidth, 390);
  assert.ok(Math.abs(phone.cssHeight - 390 * (792 / 612)) < 1e-9);
  const px = letter.width * phone.scale * letter.height * phone.scale;
  assert.ok(px <= 4_000_000 + 1, `${px} pixels`);
  assert.ok(Math.abs(phone.scale - (390 * 3) / 612) < 1e-9, "under budget: full sharpness");

  const huge = { width: 5000, height: 7000 };
  const capped = pdfPageScale(huge, 1200, 2, 4_000_000);
  const hugePx = huge.width * capped.scale * huge.height * capped.scale;
  assert.ok(hugePx <= 4_000_000 + 1, `${hugePx} pixels`);
  assert.equal(capped.cssWidth, 1200, "still shown full width, just softer");

  const odd = pdfPageScale({ width: 0, height: 0 }, 0, 0);
  assert.ok(Number.isFinite(odd.scale) && odd.scale > 0);
});
