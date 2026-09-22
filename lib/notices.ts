// Relative, not "@/lib/money": the test runner resolves plain node imports
// and doesn't know the bundler's alias, so anything under test stays free of
// it. (lib/throttle-rules.ts is split off the same way.)
import { money } from "./money.ts";

/**
 * Chasing rent, as a record rather than a text you sent and forgot.
 *
 * Sending a notice does two things: it puts the message on the tenant's
 * portal, and it writes down that you asked. The second is the part that
 * matters — you stop chasing the same person twice in a day, and if it ever
 * goes further, when you asked and whether they opened it is the question.
 */

export type NoticeKind = "rent" | "note";

export type NoticeDTO = {
  id: string;
  kind: NoticeKind;
  month: string;
  amount: number;
  body: string;
  sentBy: string;
  createdAt: string;
  readAt: string;
};

/** "September" from "2026-09", for a sentence rather than a filename. */
export function monthName(month: string) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return "";
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The message itself. Written the way a landlord actually texts — short, the
 * number first, no letterhead — and signed with the LLC rather than a person,
 * because the tenant's relationship is with the company.
 *
 * `paid` being above zero changes the wording: "you still owe $100 of $1,550"
 * reads very differently from "you owe $1,550", and getting that wrong when
 * someone has part-paid is how you lose a tenant's goodwill.
 */
export function rentNoticeBody(opts: {
  tenantName: string;
  month: string;
  expected: number;
  paid: number;
  company: string;
  place: string;
}) {
  const { tenantName, month, expected, paid, company, place } = opts;
  const owed = Math.max(0, expected - paid);
  const first = tenantName.trim().split(/\s+/)[0] || "there";
  const when = monthName(month);

  const line =
    paid > 0
      ? `We've received ${money(paid)} of the ${money(expected)} due for ${when}, so ${money(owed)} is still outstanding on ${place}.`
      : `${money(owed)} for ${when} is outstanding on ${place}.`;

  return `Hi ${first} — ${line} If you've already sent it, ignore this. Thanks — ${company}`;
}

/**
 * A tel:-style link that opens the messaging app with the text already in it.
 * iOS wants ?body= on a bare number and Android accepts it too; the leading
 * "&" variants some guides suggest break on modern iOS, so this stays plain.
 */
export function smsWithBody(phone: string, body: string) {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return `sms:${cleaned}?body=${encodeURIComponent(body)}`;
}

/** How recently the last chase went out, for "Reminded 3 days ago". */
export function remindedAgo(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const mins = Math.round((now.getTime() - then.getTime()) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 60) return "just now";
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

/**
 * Whether it's too soon to chase again. Someone reminded this morning does
 * not need reminding this afternoon, and the button says so rather than
 * letting you find out from an annoyed tenant.
 */
export const REMIND_COOLDOWN_HOURS = 20;

export function chasedRecently(iso: string | undefined, now = new Date()) {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return false;
  return now.getTime() - then < REMIND_COOLDOWN_HOURS * 60 * 60 * 1000;
}
