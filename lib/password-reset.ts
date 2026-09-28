/**
 * Password reset links: the arithmetic, kept apart from the database.
 *
 * A link is a random token in a URL. The database keeps only its hash, so
 * a leaked backup can't be turned into a way in; the link lives an hour and
 * works once; asking for another retires the old. It never bypasses
 * two-factor — someone with the link and without the phone still can't get
 * in — and using it signs the account out everywhere, because the usual
 * reason to reset a password is not being sure who has the old one.
 */

import { createHash, randomBytes } from "crypto";

export const RESET_TTL_MS = 60 * 60 * 1000;
export const MIN_PASSWORD = 8;

/** A fresh token and what to store for it. The token goes in the link, the hash in the database. */
export function newResetToken(now = new Date()): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Only a token shaped like ours is even looked up. */
export function plausibleToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,50}$/.test(token);
}

export function resetLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/reset?token=${token}`;
}

/** Live means unused and not yet expired. */
export function resetIsLive(row: { usedAt: Date | null; expiresAt: Date }, now = new Date()): boolean {
  return !row.usedAt && row.expiresAt.getTime() > now.getTime();
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > 200) return "That's too long.";
  return null;
}
