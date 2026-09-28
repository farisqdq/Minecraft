import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashToken,
  newResetToken,
  passwordProblem,
  plausibleToken,
  resetIsLive,
  resetLink,
  siteOrigin,
} from "../lib/password-reset.ts";
import { emailConfigured, resetEmail, sendEmail } from "../lib/email.ts";

test("a token is long, random, and stored only as its hash", () => {
  const a = newResetToken(new Date("2026-09-28T12:00:00Z"));
  const b = newResetToken();
  assert.notEqual(a.token, b.token);
  assert.ok(plausibleToken(a.token));
  assert.equal(a.tokenHash, hashToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.equal(a.expiresAt.toISOString(), "2026-09-28T13:00:00.000Z", "an hour");
});

test("only something shaped like a token is looked up at all", () => {
  assert.equal(plausibleToken("short"), false);
  assert.equal(plausibleToken("x".repeat(43) + "!"), false);
  assert.equal(plausibleToken(42), false);
});

test("a link is used once and dies after an hour", () => {
  const now = new Date("2026-09-28T12:30:00Z");
  const row = { usedAt: null, expiresAt: new Date("2026-09-28T13:00:00Z") };
  assert.equal(resetIsLive(row, now), true);
  assert.equal(resetIsLive({ ...row, usedAt: now }, now), false);
  assert.equal(resetIsLive(row, new Date("2026-09-28T13:00:01Z")), false);
});

test("links are built on the configured site URL, never a request header", () => {
  assert.equal(siteOrigin("http://evil.example/x", { NEXTAUTH_URL: "https://www.eqal.rentals/" }), "https://www.eqal.rentals");
  assert.equal(siteOrigin("http://localhost:3000/api/auth/forgot", {}), "http://localhost:3000");
  assert.equal(resetLink("https://www.eqal.rentals/", "abc"), "https://www.eqal.rentals/reset?token=abc");
});

test("passwords are checked the same way signup checks them", () => {
  assert.equal(passwordProblem("short"), "Use at least 8 characters.");
  assert.equal(passwordProblem("x".repeat(201)), "That's too long.");
  assert.equal(passwordProblem("correct-horse"), null);
  assert.ok(passwordProblem(undefined));
});

test("email is off until both the key and the sender are set", async () => {
  assert.equal(emailConfigured({}), false);
  assert.equal(emailConfigured({ RESEND_API_KEY: "k" }), false);
  assert.equal(emailConfigured({ RESEND_API_KEY: "k", EMAIL_FROM: "Rent Roll <no-reply@x>" }), true);
  assert.deepEqual(await sendEmail({ to: "a@b", subject: "s", text: "t" }, {}), { sent: false, reason: "unconfigured" });
});

test("sending posts once to Resend with the key, and reports a refusal honestly", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true } as Response;
  }) as unknown as typeof fetch;
  const env = { RESEND_API_KEY: "re_123", EMAIL_FROM: "Rent Roll <no-reply@eqal.rentals>" };
  assert.deepEqual(await sendEmail({ to: "a@b.com", subject: "s", text: "t" }, env, ok), { sent: true });
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer re_123");
  assert.deepEqual(JSON.parse(calls[0].init.body as string).to, ["a@b.com"]);
  const refused = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
  assert.deepEqual(await sendEmail({ to: "a@b.com", subject: "s", text: "t" }, env, refused), { sent: false, reason: "failed" });
  const down = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
  assert.deepEqual(await sendEmail({ to: "a@b.com", subject: "s", text: "t" }, env, down), { sent: false, reason: "failed" });
});

test("the email says what the link is, how long it lasts, and that ignoring it is safe", () => {
  const m = resetEmail("https://x/reset?token=t");
  assert.match(m.subject, /Reset your Rent Roll password/);
  assert.match(m.text, /https:\/\/x\/reset\?token=t/);
  assert.match(m.text, /works once/);
  assert.match(m.text, /ignore/);
});
