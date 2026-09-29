import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROOFS,
  MAX_UPLOAD_BYTES,
  PROOF_ACCEPT,
  canShrink,
  chooseUpload,
  isHeic,
  proofCountLabel,
  proofKind,
  screenPicked,
  shortName,
} from "../lib/attachments-ui.ts";

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

test("photos, iPhone HEIC and PDFs are accepted by type or by extension", () => {
  assert.equal(proofKind("a.jpg", "image/jpeg"), "image");
  assert.equal(proofKind("a.png", "image/png"), "image");
  assert.equal(proofKind("IMG_0001.HEIC", "image/heic"), "image");
  assert.equal(proofKind("IMG_0001.HEIC", ""), "image");
  assert.equal(proofKind("IMG_0001.heif", "application/octet-stream"), "image");
  assert.equal(proofKind("receipt.pdf", "application/pdf"), "pdf");
  assert.equal(proofKind("receipt.PDF", ""), "pdf");
  assert.equal(proofKind("scan.webp", "image/webp"), "image");
});

test("anything else is refused", () => {
  assert.equal(proofKind("notes.txt", "text/plain"), null);
  assert.equal(proofKind("page.html", "text/html"), null);
  assert.equal(proofKind("movie.mov", "video/quicktime"), null);
  assert.equal(proofKind("noext", ""), null);
});

test("the choose-file accept list names HEIC and PDF explicitly", () => {
  for (const part of ["image/*", "application/pdf", ".heic", ".heif"]) {
    assert.ok(PROOF_ACCEPT.split(",").includes(part), part);
  }
});

test("HEIC is spotted by type or name; GIFs and PDFs are not shrunk", () => {
  assert.equal(isHeic("x.heic", ""), true);
  assert.equal(isHeic("x.jpg", "image/heif"), true);
  assert.equal(isHeic("x.jpg", "image/jpeg"), false);
  assert.equal(canShrink("x.jpg", "image/jpeg"), true);
  assert.equal(canShrink("x.gif", "image/gif"), false);
  assert.equal(canShrink("x.pdf", "application/pdf"), false);
});

test("a pick is capped at four per entry, counting what is already there", () => {
  const five = [1, 2, 3, 4, 5].map((i) => f(`p${i}.jpg`, "image/jpeg"));
  const fresh = screenPicked(five, 0);
  assert.equal(fresh.accepted.length, MAX_PROOFS);
  assert.match(fresh.problems.join(" "), /Up to 4 files per entry — 1 left out/);

  const topUp = screenPicked(five.slice(0, 2), 3);
  assert.equal(topUp.accepted.length, 1);
  assert.equal(topUp.problems.length, 1);

  assert.equal(screenPicked([f("a.jpg", "image/jpeg")], 4).accepted.length, 0);
});

test("wrong types, empty files and oversized PDFs are turned away with a reason", () => {
  const big = MAX_UPLOAD_BYTES + 1;
  const { accepted, problems } = screenPicked(
    [
      f("notes.txt", "text/plain"),
      f("empty.jpg", "image/jpeg", 0),
      f("huge.pdf", "application/pdf", big),
      f("huge.jpg", "image/jpeg", big),
    ],
    0
  );
  assert.deepEqual(accepted.map((x) => x.name), ["huge.jpg"]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /isn't a photo or PDF/);
  assert.match(problems[1], /empty/);
  assert.match(problems[2], /over 4 MB/);
});

test("upload falls back to the original when shrinking fails (HEIC outside Safari)", () => {
  const heic = f("IMG.heic", "image/heic", 2_000_000);
  assert.deepEqual(chooseUpload(heic, null), { file: heic });
  const smaller = f("IMG.jpg", "image/jpeg", 300_000);
  assert.deepEqual(chooseUpload(heic, smaller), { file: smaller });
  const bigger = f("IMG.jpg", "image/jpeg", 3_000_000);
  assert.deepEqual(chooseUpload(heic, bigger), { file: heic });
  const tooBig = f("IMG.heic", "image/heic", MAX_UPLOAD_BYTES + 10);
  assert.ok("error" in chooseUpload(tooBig, null));
});

test("labels", () => {
  assert.equal(proofCountLabel(1), "1 proof");
  assert.equal(proofCountLabel(3), "3 proofs");
  assert.equal(shortName("short.jpg"), "short.jpg");
  const s = shortName("IMG_20260929_123456789_HDR.jpeg");
  assert.ok(s.length <= 22);
  assert.ok(s.endsWith(".jpeg"));
});
