/**
 * Emailing a password reset link from the admin panel: the words, the
 * address shown back to the admin, and the limits. Pure — no database, no
 * imports — so it tests on its own; the route in
 * app/api/admin/accounts/[id]/reset-link/email does the sending.
 *
 * The link emailed is always the one the admin was just shown, never a new
 * one: two live links for one account is two ways in, and the admin would
 * have no idea which one the person clicked.
 */

/**
 * "j***@gmail.com": enough for the admin to recognise the address it went
 * to, without the panel (or the audit log, which every admin reads) spelling
 * out someone's full address a second time.
 */
export function maskEmail(email: string): string {
  const e = email.trim();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return "***";
  return `${e[0]}***${e.slice(at)}`;
}

/**
 * Three emails to one person inside fifteen minutes is already more than
 * anyone locked out needs, and it is the ceiling that stops a slipped finger
 * (or a compromised admin) from flooding someone's inbox under the site's
 * name. Twenty per admin bounds the same thing across every account.
 */
export const MAX_SENDS_PER_TARGET = 3;
export const MAX_SENDS_PER_ADMIN = 20;

/** Throttle keys for lib/throttle.ts, prefixed so they can never collide with sign-in keys. */
export function adminMailKeys(adminId: string, targetUserId: string): { key: string; max: number }[] {
  return [
    { key: `admin-mail:to:${targetUserId}`, max: MAX_SENDS_PER_TARGET },
    { key: `admin-mail:by:${adminId}`, max: MAX_SENDS_PER_ADMIN },
  ];
}

export function mailPausedMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `That's enough emails for now — try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}, or copy the link instead.`;
}

/** What the panel says after a send, in the admin's words. */
export function mailResultMessage(
  result: { sent: true } | { sent: false; reason: "unconfigured" | "failed" },
  masked: string
): string {
  if (result.sent) return `Sent to ${masked}`;
  return result.reason === "unconfigured"
    ? "Couldn't send — email isn't set up on this site"
    : "The mail service refused it; copy the link instead";
}

/**
 * The email itself, plain text like the self-service reset email. It says
 * who it's from, because an unasked-for reset link from a stranger is
 * exactly what phishing looks like, and the person should be able to tell
 * this one apart.
 */
export function adminResetEmail(link: string, siteName = "Rent Roll"): { subject: string; text: string } {
  return {
    subject: `Reset your ${siteName} password`,
    text: [
      "Hi,",
      "",
      `The ${siteName} site admin made you a link to set a new password for your ${siteName} account:`,
      "",
      link,
      "",
      "The link works once and expires in an hour. Using it signs you out everywhere else, and it won't get you past two-factor sign-in if you have that turned on.",
      "",
      "If you weren't expecting this, you can ignore it — your password hasn't changed, and it won't unless someone uses the link.",
      "",
      `— the ${siteName} site admin`,
    ].join("\n"),
  };
}
