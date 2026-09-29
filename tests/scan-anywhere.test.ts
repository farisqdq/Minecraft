import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PROOFS, proofScanTitle, scanFileName, screenPicked } from "../lib/attachments-ui.ts";

test("a scan attached to rent is a check, anything else a receipt", () => {
  assert.equal(proofScanTitle("rent", "Sep 29, 2026"), "Rent check – Sep 29, 2026");
  assert.equal(proofScanTitle("expense", "Sep 29, 2026"), "Receipt – Sep 29, 2026");
  assert.equal(proofScanTitle(undefined, "Jan 2, 2026"), "Receipt – Jan 2, 2026");
  assert.equal(proofScanTitle("rent", ""), "Rent check");
  assert.equal(proofScanTitle("expense", "  "), "Receipt");
});

test("a scan's file name is the title plus .pdf, made safe", () => {
  assert.equal(scanFileName("Receipt – Sep 29, 2026"), "Receipt – Sep 29, 2026.pdf");
  assert.equal(scanFileName('Home Depot 3/4 "lumber"'), "Home Depot 3-4 -lumber.pdf");
  assert.equal(scanFileName("a\\b:c*d?e<f>g|h"), "a-b-c-d-e-f-g-h.pdf");
  assert.equal(scanFileName("check.pdf"), "check.pdf");
  assert.equal(scanFileName("check.PDF"), "check.pdf");
  assert.equal(scanFileName("  spaced   out  "), "spaced out.pdf");
  assert.equal(scanFileName(""), "Scan.pdf");
  assert.equal(scanFileName("..."), "Scan.pdf");
  assert.equal(scanFileName("///"), "Scan.pdf");
  assert.equal(scanFileName("x".repeat(200)), `${"x".repeat(80)}.pdf`);
});

test("a scanned PDF goes through the same four-file, 4 MB screen as a picked one", () => {
  const pdf = { name: "Receipt – Sep 29, 2026.pdf", type: "application/pdf", size: 3_900_000 };
  assert.deepEqual(screenPicked([pdf], 0).accepted, [pdf]);
  const full = screenPicked([pdf], MAX_PROOFS);
  assert.equal(full.accepted.length, 0);
  assert.match(full.problems.join(" "), /Up to 4 files/);
  const big = screenPicked([{ ...pdf, size: 5 * 1024 * 1024 }], 0);
  assert.equal(big.accepted.length, 0);
  assert.match(big.problems.join(" "), /over 4 MB/);
});
