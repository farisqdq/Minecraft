// An env var set to "" (easy to do in Vercel's UI by saving a blank value) is
// not the same as unset: next-auth treats it as a real base URL and crashes the
// build on `new URL("")`. Drop blanks so they behave like missing values.
for (const key of ["NEXTAUTH_URL", "NEXTAUTH_URL_INTERNAL", "SIGNUP_CODE"]) {
  if (process.env[key] === "") delete process.env[key];
}

// Session tokens are signed with this. The value in .env.example is public —
// it's in the repository — so a deployment using it would let anyone mint a
// login for any account. Refuse to build rather than go live like that.
if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
  const secret = process.env.NEXTAUTH_SECRET || "";
  if (!secret || secret === "replace-with-a-random-secret" || secret.length < 32) {
    throw new Error(
      "NEXTAUTH_SECRET must be set to a long random value (at least 32 characters). " +
        "Generate one with `openssl rand -base64 32` and add it in Vercel → Settings → Environment Variables."
    );
  }
}

const dev = process.env.NODE_ENV !== "production";

/**
 * What a page may load, and from where. Everything is this site unless named:
 * Google Fonts for the typefaces, and Vercel Blob for receipt and repair
 * photos. `frame-ancestors 'none'` stops another site from loading this one
 * in a hidden frame and tricking clicks out of a signed-in landlord.
 *
 * Scripts allow 'unsafe-inline' because Next.js writes small inline scripts
 * into every page to start the app. Removing that needs a per-request nonce
 * threaded through the proxy on every route; until then, the rest of this
 * policy still blocks scripts from any other origin, plugins, framing, and
 * form posts or connections to anywhere but here.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // The older header for the same thing, for browsers that predate CSP's.
  { key: "X-Frame-Options", value: "DENY" },
  // Never guess a file's type from its contents: a "photo" that is really a
  // page of HTML must not be run as one.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites see that a visitor came from here, not the page they were on
  // — a property page's address carries an id.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Nothing here needs these. Photo uploads use the phone's own camera app
  // through a file picker, which this doesn't affect.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
