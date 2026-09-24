import test from "node:test";
import assert from "node:assert/strict";
import { buildCsp, makeNonce } from "../lib/csp.ts";

test("scripts need the nonce, and inline scripts without it are not allowed", () => {
  const csp = buildCsp("abc123==");
  const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
  assert.match(script, /'nonce-abc123=='/);
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /unsafe-inline/);
  assert.doesNotMatch(script, /unsafe-eval/, "not in production");
});

test("framing, plugins and base-tag tricks are all refused", () => {
  const csp = buildCsp("n");
  for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"]) {
    assert.ok(csp.includes(d), d);
  }
});

test("dev mode adds only what the dev server's hot reload needs", () => {
  const csp = buildCsp("n", true);
  assert.match(csp, /script-src [^;]*'unsafe-eval'/);
  assert.match(csp, /connect-src 'self' ws: wss:/);
});

test("nonces are fresh every time and the right size", () => {
  const a = makeNonce(), b = makeNonce();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64").length, 16);
  assert.match(a, /^[A-Za-z0-9+/]+={0,2}$/, "matches what Next.js accepts");
});
