/**
 * The Content-Security-Policy for a page, built per request around a fresh
 * random nonce.
 *
 * Scripts: only ones carrying this request's nonce run. Next.js stamps the
 * nonce onto every script it writes into the page (it reads it back out of
 * this header), and 'strict-dynamic' extends that trust to the chunks those
 * scripts load. A script injected by anyone else — through a bug, a
 * compromised dependency's inline snippet, anything — has no nonce and is
 * refused. There is no 'unsafe-inline' for scripts.
 *
 * Styles keep 'unsafe-inline': React writes style="" attributes, which a
 * nonce can't cover, and styles can't run code.
 */
export function buildCsp(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Files are served from this site now (see /api/files), never straight
    // from storage, so images come from here — plus data: for the two-factor
    // QR code.
    "img-src 'self' data: blob:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}

/** 128 random bits, base64 — what CSP expects of a nonce. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
