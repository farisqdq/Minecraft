import test from "node:test";
import assert from "node:assert/strict";
import { sniffContentType } from "../lib/blob.ts";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const text = (s: string) => new Uint8Array([...Array.from(s, (c) => c.charCodeAt(0)), ...new Array(16).fill(0)]);

test("real photos and PDFs are recognised by their bytes", () => {
  assert.equal(sniffContentType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
  assert.equal(sniffContentType(text("GIF89a")), "image/gif");
  assert.equal(sniffContentType(text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")), "image/webp");
  assert.equal(sniffContentType(text("%PDF-1.7")), "application/pdf");
  assert.equal(sniffContentType(text("\u0000\u0000\u0000\u0018ftypheic")), "image/heic");
  assert.equal(sniffContentType(text("\u0000\u0000\u0000\u0018ftypmif1")), "image/heif");
});

test("anything wearing a photo's name is refused", () => {
  for (const evil of [
    "<!DOCTYPE html><script>",
    "<html><body>",
    "<svg xmlns=",
    "MZ\u0090\u0000", // a Windows program
    "\u007fELF",
    "PK\u0003\u0004", // a zip (and .docx)
    "#!/bin/sh",
    "\u0000\u0000\u0000\u0018ftypmp42", // a video, not a photo
  ]) {
    assert.equal(sniffContentType(text(evil)), null, JSON.stringify(evil));
  }
});
