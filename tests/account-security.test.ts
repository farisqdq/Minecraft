import test from "node:test";
import assert from "node:assert/strict";
import { openWith, sealWith } from "../lib/sealed.ts";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  hotp,
  looksLikeRecoveryCode,
  otpauthUri,
  stepAt,
  verifyTotp,
} from "../lib/totp.ts";
import { cookieFrom, makeTrustToken, readTrustToken, TRUST_DAYS } from "../lib/device-trust.ts";

/* ---- sealing ---- */

test("a sealed secret opens with the same key and not with another", () => {
  const sealed = sealWith("key-one-that-is-long-enough-000000", "JBSWY3DPEHPK3PXP");
  assert.notEqual(sealed.includes("JBSWY3DP"), true, "the plaintext isn't visible");
  assert.equal(openWith("key-one-that-is-long-enough-000000", sealed), "JBSWY3DPEHPK3PXP");
  assert.equal(openWith("a-different-key-entirely-11111111", sealed), null);
});

test("a tampered seal refuses to open rather than decrypting to junk", () => {
  const sealed = sealWith("k".repeat(40), "secret");
  const parts = sealed.split(".");
  const body = Buffer.from(parts[2], "base64url");
  body[0] ^= 1;
  parts[2] = body.toString("base64url");
  assert.equal(openWith("k".repeat(40), parts.join(".")), null);
  assert.equal(openWith("k".repeat(40), "garbage"), null);
});

test("each seal is different even for the same secret", () => {
  assert.notEqual(sealWith("k".repeat(40), "same"), sealWith("k".repeat(40), "same"));
});

/* ---- TOTP, against RFC 6238's own test vectors ---- */

const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET = base32Encode(RFC_KEY);

test("base32 round-trips", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.deepEqual(base32Decode("MZXW6YTBOI"), Buffer.from("foobar"));
  assert.deepEqual(base32Decode(RFC_SECRET), RFC_KEY);
});

test("RFC 6238 test vectors (SHA-1, 8 digits)", () => {
  for (const [t, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const) {
    assert.equal(hotp(RFC_KEY, stepAt(t), 8), expected, `T=${t}`);
  }
});

test("a current code verifies, and a clock one step off is tolerated", () => {
  const now = 1111111111;
  const code = hotp(RFC_KEY, stepAt(now));
  assert.equal(verifyTotp({ secret: RFC_SECRET, code, now }), stepAt(now));
  const early = hotp(RFC_KEY, stepAt(now) - 1);
  assert.equal(verifyTotp({ secret: RFC_SECRET, code: early, now }), stepAt(now) - 1);
  const stale = hotp(RFC_KEY, stepAt(now) - 3);
  assert.equal(verifyTotp({ secret: RFC_SECRET, code: stale, now }), null, "90 seconds old is too old");
});

test("a used code can't be used again", () => {
  const now = 1234567890;
  const code = hotp(RFC_KEY, stepAt(now));
  const step = verifyTotp({ secret: RFC_SECRET, code, now });
  assert.ok(step);
  assert.equal(verifyTotp({ secret: RFC_SECRET, code, now, lastStep: step }), null);
});

test("junk codes are refused", () => {
  for (const code of ["", "12345", "1234567", "abcdef", "12 34 5x"]) {
    assert.equal(verifyTotp({ secret: RFC_SECRET, code, now: 59 }), null, code);
  }
  assert.equal(verifyTotp({ secret: "not base32!!", code: "123456", now: 59 }), null);
});

test("new secrets are 160 bits and the setup link is well formed", () => {
  const s = generateSecret();
  assert.equal(base32Decode(s).length, 20);
  assert.notEqual(generateSecret(), s);
  const uri = otpauthUri({ issuer: "Rent Roll", account: "faris@example.com", secret: s });
  assert.match(uri, /^otpauth:\/\/totp\/Rent%20Roll%3Afaris%40example\.com\?secret=[A-Z2-7]+&issuer=Rent\+Roll/);
});

test("backup codes are unique, readable, and hashed the same however they're typed", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{3}$/);
  assert.equal(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[0].toLowerCase().replace(/-/g, " ")));
  assert.notEqual(hashRecoveryCode(codes[0]), hashRecoveryCode(codes[1]));
  assert.equal(looksLikeRecoveryCode(codes[0]), true);
  assert.equal(looksLikeRecoveryCode("123456"), false);
});

/* ---- trusted devices ---- */

const SECRET = "s".repeat(44);
const base = { secret: SECRET, kind: "user" as const, email: "faris@example.com", sessionVersion: 0 };

test("a device token is accepted for its own account only", () => {
  const token = makeTrustToken({ ...base, issuedAt: 1_000_000 });
  assert.equal(readTrustToken({ ...base, token, now: 1_000_100 }), 1_000_000);
  assert.equal(readTrustToken({ ...base, token, email: "someone@else.com", now: 1_000_100 }), null);
  assert.equal(readTrustToken({ ...base, token, kind: "tenant", now: 1_000_100 }), null);
  assert.equal(readTrustToken({ ...base, token, email: " FARIS@example.com ", now: 1_000_100 }), 1_000_000);
});

test("signing out everywhere untrusts every device", () => {
  const token = makeTrustToken({ ...base, issuedAt: 1_000_000 });
  assert.equal(readTrustToken({ ...base, token, sessionVersion: 1, now: 1_000_100 }), null);
});

test("a forged or expired device token is refused", () => {
  const token = makeTrustToken({ ...base, issuedAt: 1_000_000 });
  assert.equal(readTrustToken({ ...base, token, secret: "t".repeat(44), now: 1_000_100 }), null);
  const [e, i] = token.split(".");
  assert.equal(readTrustToken({ ...base, token: `${e}.${i}.forged`, now: 1_000_100 }), null);
  assert.equal(readTrustToken({ ...base, token, now: 1_000_000 + TRUST_DAYS * 86_400 + 1 }), null);
  assert.equal(readTrustToken({ ...base, token: "junk", now: 1 }), null);
  assert.equal(readTrustToken({ ...base, token: null, now: 1 }), null);
});

test("cookies are read out of a Cookie header", () => {
  assert.equal(cookieFrom("a=1; rr_trust_user=abc.123.x%3D; b=2", "rr_trust_user"), "abc.123.x=");
  assert.equal(cookieFrom("a=1", "rr_trust_user"), null);
  assert.equal(cookieFrom(null, "x"), null);
});
