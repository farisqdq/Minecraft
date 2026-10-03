/**
 * Automatic reminders: what to say, to whom, and when — without a database
 * or a clock of its own. lib/reminders-db.ts does the sending.
 *
 * Every date here is a plain YYYY-MM-DD, compared as calendar days in UTC.
 * The daily run is scheduled for the morning in the US, when the UTC date
 * and the local date agree, so "three days before the 1st" means the 28th
 * wherever the landlord is.
 */
import { money } from "./money.ts";
import { monthName } from "./notices.ts";
import { formatDay } from "./lease.ts";
import type { Notification } from "./notify.ts";

export type ReminderKind =
  | "rent-due"
  | "rent-late"
  | "lease-end"
  | "doc-expiry"
  | "maintenance"
  | "message"
  | "owner-statement"
  | "application"
  | "test";

export const KIND_LABEL: Record<ReminderKind, string> = {
  "rent-due": "Rent due soon",
  "rent-late": "Rent late",
  "lease-end": "Lease ending",
  "doc-expiry": "Document expiring",
  maintenance: "Repair update",
  message: "New message",
  "owner-statement": "Owner statement",
  application: "New application",
  test: "Test",
};

export type ReminderSettingsDTO = {
  /** Nothing goes out for a company until this is on. */
  enabled: boolean;
  rentDue: { on: boolean; days: number; email: boolean; push: boolean };
  rentLate: { on: boolean; graceDays: number; email: boolean; push: boolean };
  leaseEnd: { on: boolean; days: number[]; tenant: boolean; email: boolean; push: boolean };
  docExpiry: { on: boolean; days: number[]; email: boolean; push: boolean };
  maintenance: { on: boolean; email: boolean; push: boolean };
};

export const DEFAULT_SETTINGS: ReminderSettingsDTO = {
  enabled: false,
  rentDue: { on: true, days: 3, email: true, push: true },
  rentLate: { on: true, graceDays: 5, email: true, push: true },
  leaseEnd: { on: true, days: [60, 30], tenant: false, email: true, push: true },
  docExpiry: { on: true, days: [30, 7], email: true, push: true },
  maintenance: { on: true, email: true, push: true },
};

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * "60,30" or [60, 30] → [60, 30]: whole days, 1–365, no repeats, largest
 * first, at most five. Nonsense falls back rather than failing a save.
 */
export function parseDayList(value: unknown, fallback: number[]): number[] {
  const raw: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  const days = raw
    .map((v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN))
    .map((n) => Math.round(n))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 365);
  const unique = [...new Set(days)].sort((a, b) => b - a).slice(0, 5);
  return unique.length > 0 ? unique : [...fallback];
}

export const dayListString = (days: number[]) => days.join(",");

/** A settings object from whatever the form sent, each field falling back to `base`. */
export function parseSettings(input: unknown, base: ReminderSettingsDTO = DEFAULT_SETTINGS): ReminderSettingsDTO {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown> | unknown>;
  const sec = (k: string) => (i[k] && typeof i[k] === "object" ? (i[k] as Record<string, unknown>) : {});
  const rd = sec("rentDue");
  const rl = sec("rentLate");
  const le = sec("leaseEnd");
  const de = sec("docExpiry");
  const mt = sec("maintenance");
  return {
    enabled: bool(i.enabled, base.enabled),
    rentDue: {
      on: bool(rd.on, base.rentDue.on),
      days: clampInt(rd.days, 0, 31, base.rentDue.days),
      email: bool(rd.email, base.rentDue.email),
      push: bool(rd.push, base.rentDue.push),
    },
    rentLate: {
      on: bool(rl.on, base.rentLate.on),
      graceDays: clampInt(rl.graceDays, 0, 31, base.rentLate.graceDays),
      email: bool(rl.email, base.rentLate.email),
      push: bool(rl.push, base.rentLate.push),
    },
    leaseEnd: {
      on: bool(le.on, base.leaseEnd.on),
      days: "days" in le ? parseDayList(le.days, base.leaseEnd.days) : [...base.leaseEnd.days],
      tenant: bool(le.tenant, base.leaseEnd.tenant),
      email: bool(le.email, base.leaseEnd.email),
      push: bool(le.push, base.leaseEnd.push),
    },
    docExpiry: {
      on: bool(de.on, base.docExpiry.on),
      days: "days" in de ? parseDayList(de.days, base.docExpiry.days) : [...base.docExpiry.days],
      email: bool(de.email, base.docExpiry.email),
      push: bool(de.push, base.docExpiry.push),
    },
    maintenance: {
      on: bool(mt.on, base.maintenance.on),
      email: bool(mt.email, base.maintenance.email),
      push: bool(mt.push, base.maintenance.push),
    },
  };
}

/** The flat shape the database row has. */
export type SettingsRow = {
  enabled: boolean;
  rentDueOn: boolean;
  rentDueDays: number;
  rentDueEmail: boolean;
  rentDuePush: boolean;
  rentLateOn: boolean;
  rentLateGraceDays: number;
  rentLateEmail: boolean;
  rentLatePush: boolean;
  leaseEndOn: boolean;
  leaseEndDays: string;
  leaseEndTenant: boolean;
  leaseEndEmail: boolean;
  leaseEndPush: boolean;
  docExpiryOn: boolean;
  docExpiryDays: string;
  docExpiryEmail: boolean;
  docExpiryPush: boolean;
  maintenanceOn: boolean;
  maintenanceEmail: boolean;
  maintenancePush: boolean;
};

export function settingsFromRow(r: SettingsRow): ReminderSettingsDTO {
  return {
    enabled: r.enabled,
    rentDue: { on: r.rentDueOn, days: r.rentDueDays, email: r.rentDueEmail, push: r.rentDuePush },
    rentLate: { on: r.rentLateOn, graceDays: r.rentLateGraceDays, email: r.rentLateEmail, push: r.rentLatePush },
    leaseEnd: {
      on: r.leaseEndOn,
      days: parseDayList(r.leaseEndDays, DEFAULT_SETTINGS.leaseEnd.days),
      tenant: r.leaseEndTenant,
      email: r.leaseEndEmail,
      push: r.leaseEndPush,
    },
    docExpiry: {
      on: r.docExpiryOn,
      days: parseDayList(r.docExpiryDays, DEFAULT_SETTINGS.docExpiry.days),
      email: r.docExpiryEmail,
      push: r.docExpiryPush,
    },
    maintenance: { on: r.maintenanceOn, email: r.maintenanceEmail, push: r.maintenancePush },
  };
}

export function settingsToRow(s: ReminderSettingsDTO): SettingsRow {
  return {
    enabled: s.enabled,
    rentDueOn: s.rentDue.on,
    rentDueDays: s.rentDue.days,
    rentDueEmail: s.rentDue.email,
    rentDuePush: s.rentDue.push,
    rentLateOn: s.rentLate.on,
    rentLateGraceDays: s.rentLate.graceDays,
    rentLateEmail: s.rentLate.email,
    rentLatePush: s.rentLate.push,
    leaseEndOn: s.leaseEnd.on,
    leaseEndDays: dayListString(s.leaseEnd.days),
    leaseEndTenant: s.leaseEnd.tenant,
    leaseEndEmail: s.leaseEnd.email,
    leaseEndPush: s.leaseEnd.push,
    docExpiryOn: s.docExpiry.on,
    docExpiryDays: dayListString(s.docExpiry.days),
    docExpiryEmail: s.docExpiry.email,
    docExpiryPush: s.docExpiry.push,
    maintenanceOn: s.maintenance.on,
    maintenanceEmail: s.maintenance.email,
    maintenancePush: s.maintenance.push,
  };
}

/* ---------- Calendar arithmetic, all UTC ---------- */

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parse(iso: string): number {
  return ISO_DAY.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN;
}

export function addDays(iso: string, n: number): string {
  return isoDate(new Date(parse(iso) + n * DAY_MS));
}

/** Whole days from one date to another; negative when `to` is earlier. */
export function daysFromTo(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}

export const monthOfDate = (iso: string) => iso.slice(0, 7);

export function nextMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The day rent is due in a month; a due day past the month's end lands on its last day. */
export function dueDateIn(month: string, dueDay: number): string {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Math.round(dueDay) || 1), lastDay);
  return `${month}-${String(day).padStart(2, "0")}`;
}

export type RentDuePlan = { month: string; dueOn: string; daysAway: number };

/** The next rent day on or after today: this month's, or next month's once it has passed. */
export function upcomingRent(today: string, dueDay: number): RentDuePlan {
  const thisMonth = monthOfDate(today);
  let dueOn = dueDateIn(thisMonth, dueDay);
  let month = thisMonth;
  if (dueOn < today) {
    month = nextMonthOf(thisMonth);
    dueOn = dueDateIn(month, dueDay);
  }
  return { month, dueOn, daysAway: daysFromTo(today, dueOn) };
}

/**
 * The reminder to send today, if the next rent day is within `daysBefore`
 * days. "Within" rather than "exactly": a run that was missed one morning
 * still reminds the next, and the sent-log stops it repeating.
 */
export function rentDueSoon(today: string, dueDay: number, daysBefore: number): RentDuePlan | null {
  const plan = upcomingRent(today, dueDay);
  return plan.daysAway <= daysBefore ? plan : null;
}

/** Has the grace period for a month's rent run out as of today? */
export function rentIsLate(today: string, month: string, dueDay: number, graceDays: number): boolean {
  return today >= addDays(dueDateIn(month, dueDay), Math.max(0, graceDays));
}

/**
 * Which "N days before" reminder applies when something is `daysUntil`
 * days away: the tightest threshold it's inside. At 45 days out with
 * thresholds of 60 and 30 that's the 60; at 20 it's the 30. Past the date,
 * nothing — the dashboard already shows what has lapsed.
 */
export function pickThreshold(daysUntil: number, thresholds: number[]): number | null {
  if (daysUntil < 0) return null;
  const inside = thresholds.filter((t) => daysUntil <= t);
  return inside.length > 0 ? Math.min(...inside) : null;
}

/* ---------- Keys, so nothing is sent twice ---------- */

export const reminderKey = {
  rentDue: (tenantId: string, month: string) => `rent-due:${tenantId}:${month}`,
  rentLate: (tenantId: string, month: string) => `rent-late:${tenantId}:${month}`,
  leaseEnd: (tenantId: string, leaseEnd: string, threshold: number) => `lease-end:${tenantId}:${leaseEnd}:${threshold}`,
  docExpiry: (documentId: string, expiresOn: string, threshold: number) =>
    `doc-expiry:${documentId}:${expiresOn}:${threshold}`,
  maintenance: (updateId: string) => `maintenance:${updateId}`,
  message: (messageId: string) => `message:${messageId}`,
  application: (applicationId: string) => `application:${applicationId}`,
  test: (userId: string, at: number) => `test:${userId}:${at}`,
};

/* ---------- What the messages say ---------- */

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

const when = (daysAway: number, dueOn: string) =>
  daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : `on ${formatDay(dueOn)}`;

export function rentDueNotification(opts: {
  tenantName: string;
  place: string;
  company: string;
  amount: number;
  dueOn: string;
  daysAway: number;
  /** Anything already outstanding from before, so the number isn't a surprise. */
  owed: number;
  url: string;
}): Notification {
  const { tenantName, place, company, amount, dueOn, daysAway, owed, url } = opts;
  const due = when(daysAway, dueOn);
  const extra = owed > 0.005 ? ` There is also ${money(owed)} outstanding from before.` : "";
  return {
    subject: `Rent of ${money(amount)} is due ${due} — ${place}`,
    text: [
      `Hi ${firstName(tenantName)} —`,
      "",
      `A reminder that rent of ${money(amount)} for ${place} is due ${due}.${extra}`,
      "",
      `You can see your account here: ${url}`,
      "",
      `Thanks — ${company}`,
    ].join("\n"),
    short: `Rent of ${money(amount)} for ${place} is due ${due}.${extra}`,
    url,
    tag: "rent-due",
  };
}

export function rentLateNotification(opts: {
  tenantName: string;
  place: string;
  company: string;
  /**
   * Rent owed, late fees excluded (lib/rent-owed.ts). This is the headline
   * figure and the one a landlord may copy into a 7-day pay-or-quit notice,
   * which in Kentucky must not include late fees.
   */
  rentOwed: number;
  behindSince: string;
  /** The late-fee clause from lib/late-fee-text.ts, or "" when none applies. */
  lateFee?: string;
  url: string;
}): Notification {
  const { tenantName, place, company, rentOwed, behindSince, url } = opts;
  const since = behindSince ? ` (going back to ${monthName(behindSince)})` : "";
  // "$1,000 of rent is past due on 12 Oak St. Separately, a $70 late fee was
  // added; $5/day more until paid, up to $120." The fee is its own sentence so
  // it never reads as part of the rent figure.
  const fee = opts.lateFee ? ` Separately, ${opts.lateFee}.` : "";
  const headline = `${money(rentOwed)} of rent is past due on ${place}${since}.`;
  return {
    subject: `${money(rentOwed)} of rent is past due — ${place}`,
    text: [
      `Hi ${firstName(tenantName)} —`,
      "",
      `${headline}${fee} If you've already sent it, please ignore this.`,
      "",
      `Your account: ${url}`,
      "",
      `Thanks — ${company}`,
    ].join("\n"),
    short: `${headline}${fee} If you've already paid, ignore this.`,
    url,
    tag: "rent-late",
  };
}

export function leaseEndNotification(opts: {
  who: "tenant" | "landlord";
  tenantName: string;
  place: string;
  company: string;
  leaseEnd: string;
  days: number;
  url: string;
}): Notification {
  const { who, tenantName, place, company, leaseEnd, days, url } = opts;
  const on = formatDay(leaseEnd);
  const inDays = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  if (who === "tenant") {
    return {
      subject: `Your lease at ${place} ends ${on}`,
      text: [
        `Hi ${firstName(tenantName)} —`,
        "",
        `Your lease at ${place} ends ${inDays}, on ${on}. Please get in touch about renewing or moving out.`,
        "",
        `Thanks — ${company}`,
      ].join("\n"),
      short: `Your lease at ${place} ends ${inDays} (${on}). Get in touch about renewing.`,
      url,
      tag: "lease-end",
    };
  }
  return {
    subject: `${tenantName}'s lease at ${place} ends ${inDays}`,
    text: [
      `${tenantName}'s lease at ${place} ends ${inDays}, on ${on}.`,
      "",
      `Time to talk about a renewal, a rent change or a move-out: ${url}`,
    ].join("\n"),
    short: `${tenantName}'s lease at ${place} ends ${inDays} (${on}).`,
    url,
    tag: "lease-end",
  };
}

export function docExpiryNotification(opts: {
  title: string;
  kind: string;
  about: string;
  expiresOn: string;
  days: number;
  url: string;
}): Notification {
  const { title, kind, about, expiresOn, days, url } = opts;
  const on = formatDay(expiresOn);
  const inDays = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return {
    subject: `${title} expires ${inDays}`,
    text: [`${title} (${kind}, ${about}) expires ${inDays}, on ${on}.`, "", `Filing cabinet: ${url}`].join("\n"),
    short: `${title} (${about}) expires ${inDays}, on ${on}.`,
    url,
    tag: "doc-expiry",
  };
}

export function maintenanceNotification(opts: {
  tenantName: string;
  company: string;
  title: string;
  body: string;
  /** The tenant-facing label when the row was a status change. */
  status: string;
  url: string;
}): Notification {
  const { tenantName, company, title, body, status, url } = opts;
  const line = status ? `Your request "${title}" is now: ${status}.` : `An update on your request "${title}":`;
  const note = status ? (body && body !== status ? `\n\n${body}` : "") : `\n\n${body}`;
  return {
    subject: status ? `${title}: ${status}` : `Update on ${title}`,
    text: [`Hi ${firstName(tenantName)} —`, "", `${line}${note}`, "", `See it here: ${url}`, "", `— ${company}`].join("\n"),
    short: status ? `${title}: ${status}${body && body !== status ? ` — ${body.slice(0, 120)}` : ""}` : `${title}: ${body.slice(0, 140)}`,
    url,
    tag: "maintenance",
  };
}

export function messageNotification(opts: {
  from: string;
  preview: string;
  count: number;
  url: string;
}): Notification {
  const { from, preview, count, url } = opts;
  const what = count > 1 ? `${count} new messages from ${from}` : `New message from ${from}`;
  return {
    subject: what,
    text: [`${what}:`, "", `"${preview}"`, "", `Reply here: ${url}`].join("\n"),
    short: `${from}: ${preview.slice(0, 140)}`,
    url,
    tag: "message",
  };
}

export function testNotification(opts: { company: string; url: string }): Notification {
  return {
    subject: `Test reminder from ${opts.company}`,
    text: [
      `This is a test of ${opts.company}'s automatic reminders. If you're reading it, this channel works.`,
      "",
      `Settings: ${opts.url}`,
    ].join("\n"),
    short: `This is a test. Reminders from ${opts.company} will look like this.`,
    url: opts.url,
    tag: "test",
  };
}
