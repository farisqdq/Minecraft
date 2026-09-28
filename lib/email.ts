/**
 * Sending one email, when the site has been given a way to.
 *
 * Nothing in the app depends on email — codes and links are handed over
 * however people already talk to each other — so this is the one place
 * that does, and it degrades honestly: with no RESEND_API_KEY set,
 * sendEmail() says it didn't send, and the caller says so to the person.
 *
 * Resend's HTTP API is used directly rather than through an SDK, because
 * one POST doesn't need a dependency.
 */

export type EmailResult = { sent: true } | { sent: false; reason: "unconfigured" | "failed" };

export function emailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export async function sendEmail(
  message: { to: string; subject: string; text: string },
  env: Record<string, string | undefined> = process.env,
  doFetch: typeof fetch = fetch
): Promise<EmailResult> {
  if (!emailConfigured(env)) return { sent: false, reason: "unconfigured" };
  try {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
    });
    return res.ok ? { sent: true } : { sent: false, reason: "failed" };
  } catch {
    return { sent: false, reason: "failed" };
  }
}

/** The reset email, plain text: the link is the whole message. */
export function resetEmail(link: string, siteName = "Rent Roll"): { subject: string; text: string } {
  return {
    subject: `Reset your ${siteName} password`,
    text: [
      `Someone — hopefully you — asked to reset the password on your ${siteName} account.`,
      "",
      `Set a new one here (the link works once, for the next hour):`,
      link,
      "",
      "If you didn't ask for this, you can ignore it. Your password hasn't changed.",
    ].join("\n"),
  };
}
