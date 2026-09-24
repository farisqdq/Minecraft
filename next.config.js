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

// The Content-Security-Policy is set per request in proxy.ts, because each
// response carries its own script nonce. These are the fixed ones.
const securityHeaders = [
  // The older header for the frame-ancestors part of the CSP, for browsers
  // that predate it.
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
