import test from "node:test";
import assert from "node:assert/strict";
import { crossSiteMutation } from "../lib/origin.ts";

const host = "eqal.rentals";

test("reads are never blocked", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(crossSiteMutation({ method, origin: "https://evil.example", host }), false);
  }
});

test("a change from this site is allowed", () => {
  assert.equal(crossSiteMutation({ method: "POST", origin: "https://eqal.rentals", host }), false);
  assert.equal(crossSiteMutation({ method: "DELETE", origin: "https://EQAL.rentals", host }), false);
  assert.equal(crossSiteMutation({ method: "PATCH", origin: "http://localhost:3111", host: "localhost:3111" }), false);
  // Behind Vercel's edge, the public host arrives as x-forwarded-host.
  assert.equal(
    crossSiteMutation({ method: "POST", origin: "https://eqal.rentals", host: "internal.vercel", forwardedHost: host }),
    false
  );
});

test("a change from another site is refused", () => {
  assert.equal(crossSiteMutation({ method: "POST", origin: "https://evil.example", host }), true);
  assert.equal(crossSiteMutation({ method: "POST", origin: "https://eqal.rentals.evil.example", host }), true);
  assert.equal(crossSiteMutation({ method: "PUT", origin: "null", host }), true);
  assert.equal(crossSiteMutation({ method: "POST", origin: "not a url", host }), true);
  // Same name, different port, is a different site.
  assert.equal(crossSiteMutation({ method: "POST", origin: "https://eqal.rentals:8443", host }), true);
});

test("no Origin means not a browser page, left to the route", () => {
  assert.equal(crossSiteMutation({ method: "POST", origin: null, host }), false);
});
