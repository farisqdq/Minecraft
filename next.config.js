// An env var set to "" (easy to do in Vercel's UI by saving a blank value) is
// not the same as unset: next-auth treats it as a real base URL and crashes the
// build on `new URL("")`. Drop blanks so they behave like missing values.
for (const key of ["NEXTAUTH_URL", "NEXTAUTH_URL_INTERNAL", "SIGNUP_CODE"]) {
  if (process.env[key] === "") delete process.env[key];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
};

module.exports = nextConfig;
