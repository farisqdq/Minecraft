import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Two-factor codes from an authenticator app (Google Authenticator, Authy,
 * 1Password, the iPhone's Passwords app): TOTP, RFC 6238 — HMAC-SHA1 over a
 * 30-second counter, six digits. Written out here rather than pulled in as a
 * dependency because it is forty lines and the part of login least worth
 * trusting to someone else's package.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Not base32.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, the size RFC 4226 recommends for SHA-1. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function stepAt(unixSeconds: number): number {
  return Math.floor(unixSeconds / STEP_SECONDS);
}

/**
 * Checks a code against this window and one either side (phone clocks
 * drift), and refuses any window at or before the last one accepted — so a
 * code, once used, is spent. Returns the window to record, or null.
 */
export function verifyTotp(opts: {
  secret: string;
  code: string;
  now?: number;
  lastStep?: number | null;
}): number | null {
  const code = opts.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  let key: Buffer;
  try {
    key = base32Decode(opts.secret);
  } catch {
    return null;
  }
  const current = stepAt(opts.now ?? Date.now() / 1000);
  for (const step of [current - 1, current, current + 1]) {
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** The link an authenticator app understands, shown as a QR code. */
export function otpauthUri(opts: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ---- one-time backup codes, for a lost or replaced phone ---- */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Ten codes like "K7QM-2XPA-9D": about 55 bits each. Shown once, stored hashed. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(11);
    const raw = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 11)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * SHA-256 is enough here, unlike for passwords: the codes are random and
 * long, so there is no dictionary to try against a leaked hash.
 */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`rent-roll-recovery:${normalizeRecoveryCode(code)}`).digest("hex");
}

/** Whether a typed code looks like a backup code rather than a 6-digit one. */
export function looksLikeRecoveryCode(code: string): boolean {
  return normalizeRecoveryCode(code).length === 11;
}
