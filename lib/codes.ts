import { randomBytes } from "crypto";

// No I, L, O, 0 or 1 — these get misread when a code is written down or read
// out loud, which is how most of these will travel.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

export function generateJoinCode() {
  const bytes = randomBytes(LENGTH);
  let code = "";
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/** Accepts whatever the person typed: spaces, dashes, lower case. */
export function normalizeJoinCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatJoinCode(code: string) {
  return code.length === LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
