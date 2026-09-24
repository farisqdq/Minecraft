import { createHmac, timingSafeEqual } from "crypto";

/**
 * "This device has signed in to this account before" — a signed cookie that
 * lets the real owner keep signing in while someone elsewhere is typing
 * wrong passwords at their account (OWASP's device-cookie defence).
 *
 * Without it, ten wrong guesses from anywhere locked the account for
 * everyone for fifteen minutes, which let a stranger keep a landlord out on
 * purpose. With it, that lock applies only to devices the account has never
 * signed in from; a trusted device has its own separate count.
 *
 * The signature covers the account's sessionVersion, so "sign out
 * everywhere" and a password change also make every device untrusted.
 */

export type TrustKind = "user" | "tenant";

/** How long a device stays trusted without signing in again. */
export const TRUST_DAYS = 90;

export const trustCookieName = (kind: TrustKind) => `rr_trust_${kind}`;

function sign(secret: string, parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join("\u0000")).digest("base64url");
}

export function makeTrustToken(opts: {
  secret: string;
  kind: TrustKind;
  email: string;
  sessionVersion: number;
  issuedAt?: number;
}): string {
  const issuedAt = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const email = opts.email.trim().toLowerCase();
  const sig = sign(opts.secret, [opts.kind, email, String(opts.sessionVersion), String(issuedAt)]);
  return `${Buffer.from(email).toString("base64url")}.${issuedAt}.${sig}`;
}

/** The token's issue time if it is genuine, current and for this account; otherwise null. */
export function readTrustToken(opts: {
  secret: string;
  token: string | undefined | null;
  kind: TrustKind;
  email: string;
  sessionVersion: number;
  now?: number;
}): number | null {
  if (!opts.token || !opts.secret) return null;
  const [emailPart, issuedPart, sig] = opts.token.split(".");
  if (!emailPart || !issuedPart || !sig) return null;
  const email = opts.email.trim().toLowerCase();
  let tokenEmail: string;
  try {
    tokenEmail = Buffer.from(emailPart, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (tokenEmail !== email) return null;
  const issuedAt = Number(issuedPart);
  if (!Number.isInteger(issuedAt)) return null;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (issuedAt > now + 300 || now - issuedAt > TRUST_DAYS * 86_400) return null;
  const expected = sign(opts.secret, [opts.kind, email, String(opts.sessionVersion), String(issuedAt)]);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? issuedAt : null;
}

/** Pull one cookie's value out of a raw Cookie header. */
export function cookieFrom(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
