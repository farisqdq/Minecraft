import test from "node:test";
import assert from "node:assert/strict";
import { safeCallbackUrl } from "../lib/safe-redirect.ts";

test("paths on this site are kept", () => {
  assert.equal(safeCallbackUrl("/dashboard"), "/dashboard");
  assert.equal(safeCallbackUrl("/dashboard/properties/abc?tab=rent#x"), "/dashboard/properties/abc?tab=rent#x");
  assert.equal(safeCallbackUrl("/portal", "/portal"), "/portal");
});

test("anything that leaves the site falls back", () => {
  for (const evil of [
    "https://evil.example/login",
    "http://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "evil.example",
    "",
    "   ",
  ]) {
    assert.equal(safeCallbackUrl(evil), "/dashboard", JSON.stringify(evil));
  }
  assert.equal(safeCallbackUrl(null), "/dashboard");
  assert.equal(safeCallbackUrl(undefined, "/portal"), "/portal");
});
