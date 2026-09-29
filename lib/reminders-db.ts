import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emailConfigured, sendEmail } from "@/lib/email";
import { pushConfigured, sendPush } from "@/lib/push";
import type { Channel, Notification } from "@/lib/notify";
import {
  DEFAULT_SETTINGS,
  addDays,
  daysFromTo,
  docExpiryNotification,
  isoDate,
  leaseEndNotification,
  maintenanceNotification,
  monthOfDate,
  pickThreshold,
  reminderKey,
  rentDueNotification,
  rentDueSoon,
  rentIsLate,
  rentLateNotification,
  settingsFromRow,
  settingsToRow,
  testNotification,
  type ReminderKind,
  type ReminderSettingsDTO,
} from "@/lib/reminders";
import { statementForTenant, type StatementResult } from "@/lib/statements";
import { lateFeeSummary } from "@/lib/late-fee-text";
import { rentOwed } from "@/lib/rent-owed";
import { rentForMonth, type RentChangeDTO } from "@/lib/rent";
import { rentTargetOf } from "@/lib/rent-target";
import { STATUS_LABEL, type RequestStatus } from "@/lib/maintenance";

/**
 * The sending half of automatic reminders: who gets what, by which
 * channel, exactly once.
 *
 * Every send is claimed in ReminderSent before it goes out, under a key
 * that names the thing being reminded about. The unique index on that key
 * is the guarantee: a second run of the same morning, or two runs landing
 * together, finds the claim and stops. Nobody is told twice that rent is
 * due on the 1st.
 */

/* ---------- Settings ---------- */

export async function settingsFor(companyId: string): Promise<ReminderSettingsDTO> {
  const row = await prisma.reminderSettings.findUnique({ where: { companyId } });
  return row ? settingsFromRow(row) : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(companyId: string, settings: ReminderSettingsDTO): Promise<ReminderSettingsDTO> {
  const data = settingsToRow(settings);
  const row = await prisma.reminderSettings.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  });
  return settingsFromRow(row);
}

/** Settings plus what has gone out lately, for the settings page. */
export async function reminderSnapshot(companyId: string) {
  const [settings, log] = await Promise.all([
    settingsFor(companyId),
    prisma.reminderSent.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, kind: true, channel: true, to: true, status: true, detail: true, createdAt: true },
    }),
  ]);
  return {
    settings,
    log: log.map((l) => ({ ...l, detail: l.detail ?? "", createdAt: l.createdAt.toISOString() })),
    email: emailConfigured(),
    push: pushConfigured(),
    cron: Boolean(process.env.CRON_SECRET),
  };
}

export type ReminderSnapshot = Awaited<ReturnType<typeof reminderSnapshot>>;

/* ---------- Who ---------- */

export type Recipient =
  | { kind: "user"; id: string; email: string; name: string }
  | {
      kind: "tenant";
      /** The tenant row, not the login. */
      id: string;
      accountId: string | null;
      email: string | null;
      name: string;
      emailOk: boolean;
      pushOk: boolean;
    };

type TenantLike = {
  id: string;
  name: string;
  email: string | null;
  emailReminders: boolean;
  pushReminders: boolean;
  account: { id: string; email: string } | null;
};

/** A tenant as a recipient: their own address, or their login's, and their two switches. */
export function tenantRecipient(t: TenantLike): Recipient {
  return {
    kind: "tenant",
    id: t.id,
    accountId: t.account?.id ?? null,
    email: t.email?.trim() || t.account?.email || null,
    name: t.name,
    emailOk: t.emailReminders,
    pushOk: t.pushReminders,
  };
}

/** Everyone on the company's team. */
export async function landlordRecipients(companyId: string): Promise<Recipient[]> {
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  return members.map((m) => ({ kind: "user", id: m.user.id, email: m.user.email, name: m.user.name ?? "" }));
}

/* ---------- Sending ---------- */

export type Outcome = "sent" | "failed" | "skipped" | "duplicate";

export type PushReport = { devices: number; sent: number; failed: number; gone: number; unconfigured: boolean };

/** Push to every device someone has enabled, dropping the ones the push service says are gone. */
export async function pushToDevices(
  target: { userId?: string; tenantAccountId?: string },
  n: Notification
): Promise<PushReport> {
  const where = target.userId ? { userId: target.userId } : target.tenantAccountId ? { tenantAccountId: target.tenantAccountId } : null;
  if (!where) return { devices: 0, sent: 0, failed: 0, gone: 0, unconfigured: !pushConfigured() };
  const subs = await prisma.pushSubscription.findMany({ where });
  const report: PushReport = { devices: subs.length, sent: 0, failed: 0, gone: 0, unconfigured: false };
  for (const s of subs) {
    const r = await sendPush(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      { title: n.subject, body: n.short, url: n.url, tag: n.tag }
    );
    if (r.sent) {
      report.sent += 1;
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    } else if (r.reason === "gone") {
      report.gone += 1;
      await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
    } else if (r.reason === "unconfigured") {
      report.unconfigured = true;
      break;
    } else {
      report.failed += 1;
    }
  }
  return report;
}

const isUniqueClash = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * One notification, one channel, one person — once. The claim goes in
 * first; a clash on the key means it already went (or is going) and the
 * answer is "duplicate".
 */
export async function deliver(opts: {
  companyId: string;
  kind: ReminderKind;
  key: string;
  channel: Channel;
  recipient: Recipient;
  notification: Notification;
}): Promise<Outcome> {
  const { companyId, kind, key, channel, recipient, notification } = opts;
  const to =
    channel === "email"
      ? recipient.email
      : recipient.kind === "user"
        ? `user:${recipient.id}`
        : recipient.accountId
          ? `tenant:${recipient.accountId}`
          : null;
  if (!to) return "skipped";
  if (recipient.kind === "tenant" && (channel === "email" ? !recipient.emailOk : !recipient.pushOk)) return "skipped";

  let claim: { id: string };
  try {
    claim = await prisma.reminderSent.create({ data: { companyId, kind, key, channel, to }, select: { id: true } });
  } catch (err) {
    if (isUniqueClash(err)) return "duplicate";
    throw err;
  }

  let status: Outcome;
  let detail: string | null = null;
  if (channel === "email") {
    const r = await sendEmail({ to, subject: notification.subject, text: notification.text });
    status = r.sent ? "sent" : r.reason === "unconfigured" ? "skipped" : "failed";
    detail = r.sent ? null : r.reason === "unconfigured" ? "email isn't set up" : "the mail service refused it";
  } else {
    const r = await pushToDevices(
      recipient.kind === "user" ? { userId: recipient.id } : { tenantAccountId: recipient.accountId! },
      notification
    );
    if (r.unconfigured) {
      status = "skipped";
      detail = "push isn't set up";
    } else if (r.devices === 0) {
      status = "skipped";
      detail = "no device has notifications on";
    } else if (r.sent > 0) {
      status = "sent";
      detail = `${r.sent} of ${r.devices} device${r.devices === 1 ? "" : "s"}`;
    } else {
      status = "failed";
      detail = r.gone === r.devices ? "every device had unsubscribed" : "the push service refused it";
    }
  }
  await prisma.reminderSent.update({ where: { id: claim.id }, data: { status, detail } });
  return status;
}

export type Tally = Record<Outcome, number>;

const tally = (): Tally => ({ sent: 0, failed: 0, skipped: 0, duplicate: 0 });

/** The same notification to several people by whichever channels the settings allow. */
export async function notify(opts: {
  companyId: string;
  kind: ReminderKind;
  key: string;
  recipients: Recipient[];
  channels: { email: boolean; push: boolean };
  notification: Notification;
}): Promise<Tally> {
  const t = tally();
  for (const recipient of opts.recipients) {
    for (const channel of ["email", "push"] as Channel[]) {
      if (!opts.channels[channel]) continue;
      const outcome = await deliver({ ...opts, channel, recipient });
      t[outcome] += 1;
    }
  }
  return t;
}

/* ---------- The daily run ---------- */

export type RunReport = {
  today: string;
  companies: number;
  tenants: number;
  sent: number;
  failed: number;
  skipped: number;
  duplicate: number;
  /** One line per reminder that went somewhere, for the cron's own log. */
  notes: string[];
};

const tenantInclude = {
  property: {
    select: { id: true, name: true, monthlyRent: true, units: { select: { id: true, name: true, monthlyRent: true } } },
  },
  unit: { select: { id: true, name: true, monthlyRent: true } },
  account: { select: { id: true, email: true } },
  rules: { where: { active: true, kind: "late" }, select: { graceDays: true } },
} satisfies Prisma.TenantInclude;

export async function runReminders(now: Date, origin: string): Promise<RunReport> {
  const today = isoDate(now);
  const report: RunReport = { today, companies: 0, tenants: 0, sent: 0, failed: 0, skipped: 0, duplicate: 0, notes: [] };
  const add = (t: Tally, note: string) => {
    report.sent += t.sent;
    report.failed += t.failed;
    report.skipped += t.skipped;
    report.duplicate += t.duplicate;
    if (t.sent > 0 || t.failed > 0) report.notes.push(`${note}: ${t.sent} sent, ${t.failed} failed`);
  };

  const rows = await prisma.reminderSettings.findMany({
    where: { enabled: true },
    include: { company: { select: { id: true, name: true } } },
  });

  for (const row of rows) {
    report.companies += 1;
    const s = settingsFromRow(row);
    const companyId = row.companyId;
    const companyName = row.company.name;
    const landlords = await landlordRecipients(companyId);
    const portalUrl = `${origin}/portal`;

    const tenants = await prisma.tenant.findMany({
      where: { active: true, property: { companyId } },
      include: tenantInclude,
    });

    for (const t of tenants) {
      report.tenants += 1;
      const place = t.unit ? `${t.property.name} ${t.unit.name}` : t.property.name;
      const recipient = tenantRecipient(t);
      const tenantUrl = `${origin}/dashboard/properties/${t.propertyId}#tenant-${t.id}`;

      // The statement is what both rent reminders rest on: it knows what's
      // been paid, what's owed from before, and applies any late-fee rule.
      const stmt = s.rentDue.on || s.rentLate.on ? await statementForTenant(t.id, now).catch(() => null) : null;
      const trusted = Boolean(stmt && !stmt.problem);
      const balance = trusted ? stmt!.statement.balance : 0;

      if (s.rentDue.on) {
        const plan = rentDueSoon(today, t.dueDay, s.rentDue.days);
        if (plan) {
          // The rent the statement expects: on a single-unit property the
          // whole property is its unit (lib/rent-target.ts).
          const targetUnitId = rentTargetOf(t.unitId, t.property.units);
          const targetUnit = t.property.units.find((u) => u.id === targetUnitId) ?? null;
          const changes = await prisma.rentChange.findMany({ where: { propertyId: t.propertyId, unitId: targetUnitId } });
          const dtos: RentChangeDTO[] = changes.map((c) => ({
            id: c.id,
            propertyId: c.propertyId,
            unitId: c.unitId,
            effectiveFrom: isoDate(c.effectiveFrom).slice(0, 7),
            amount: c.amount,
          }));
          const amount = rentForMonth(dtos, t.propertyId, targetUnitId, plan.month, targetUnit?.monthlyRent ?? t.property.monthlyRent);
          // Nothing to remind about when there's no rent, or it's already covered by credit.
          const prepaid = trusted && balance <= -amount + 0.005;
          if (amount > 0 && !prepaid) {
            const n = rentDueNotification({
              tenantName: t.name,
              place,
              company: companyName,
              amount,
              dueOn: plan.dueOn,
              daysAway: plan.daysAway,
              owed: Math.max(0, balance),
              url: portalUrl,
            });
            add(
              await notify({ companyId, kind: "rent-due", key: reminderKey.rentDue(t.id, plan.month), recipients: [recipient], channels: s.rentDue, notification: n }),
              `rent due, ${t.name}`
            );
          }
        }
      }

      // The rent-late reminder states rent only (lib/rent-owed.ts): late fees
      // come off the headline figure, because it's the one a landlord would
      // copy into a 7-day pay-or-quit notice and in Kentucky that amount must
      // not include them. The fee still gets its own sentence. Owing nothing
      // but late fees isn't "rent late", so that sends nothing.
      const rentLate = trusted ? rentOwed(stmt!) : null;
      if (s.rentLate.on && rentLate && rentLate.rent > 0.005) {
        const month = monthOfDate(today);
        // A late-fee rule's grace period is the tenant's own; the company
        // figure is for tenants without one.
        const grace = t.rules.length > 0 ? Math.min(...t.rules.map((r) => r.graceDays)) : s.rentLate.graceDays;
        const behindSince = rentLate.behindSince || month;
        if (rentIsLate(today, behindSince, t.dueDay, grace)) {
          const n = rentLateNotification({
            tenantName: t.name,
            place,
            company: companyName,
            rentOwed: rentLate.rent,
            behindSince,
            lateFee: lateFeeClause(stmt!, month),
            url: portalUrl,
          });
          const result = await notify({ companyId, kind: "rent-late", key: reminderKey.rentLate(t.id, month), recipients: [recipient], channels: s.rentLate, notification: n });
          add(result, `rent late, ${t.name}`);
          // On the record like a chase sent by hand: the portal shows it,
          // the tenant card says "reminded", and there's a date if it ever
          // goes further.
          if (result.sent > 0) {
            await prisma.tenantNotice.create({ data: { tenantId: t.id, kind: "rent", month, amount: rentLate.rent, body: n.short } });
          }
        }
      }

      if (s.leaseEnd.on && t.leaseEnd) {
        const leaseEnd = isoDate(t.leaseEnd);
        const days = daysFromTo(today, leaseEnd);
        const threshold = pickThreshold(days, s.leaseEnd.days);
        if (threshold !== null) {
          const key = reminderKey.leaseEnd(t.id, leaseEnd, threshold);
          add(
            await notify({
              companyId,
              kind: "lease-end",
              key,
              recipients: landlords,
              channels: s.leaseEnd,
              notification: leaseEndNotification({ who: "landlord", tenantName: t.name, place, company: companyName, leaseEnd, days, url: tenantUrl }),
            }),
            `lease ending, ${t.name} (to the team)`
          );
          if (s.leaseEnd.tenant) {
            add(
              await notify({
                companyId,
                kind: "lease-end",
                key,
                recipients: [recipient],
                channels: s.leaseEnd,
                notification: leaseEndNotification({ who: "tenant", tenantName: t.name, place, company: companyName, leaseEnd, days, url: portalUrl }),
              }),
              `lease ending, ${t.name} (to them)`
            );
          }
        }
      }
    }

    if (s.docExpiry.on && s.docExpiry.days.length > 0) {
      const horizon = addDays(today, Math.max(...s.docExpiry.days));
      const docs = await prisma.document.findMany({
        where: {
          companyId,
          expiresOn: { gte: new Date(`${today}T00:00:00.000Z`), lte: new Date(`${horizon}T00:00:00.000Z`) },
          // A moved-out tenant's paperwork has stopped mattering.
          OR: [{ tenantId: null }, { tenant: { active: true } }],
        },
        include: { property: { select: { name: true } }, tenant: { select: { name: true } }, vendor: { select: { name: true } } },
      });
      for (const d of docs) {
        const expiresOn = isoDate(d.expiresOn!);
        const days = daysFromTo(today, expiresOn);
        const threshold = pickThreshold(days, s.docExpiry.days);
        if (threshold === null) continue;
        add(
          await notify({
            companyId,
            kind: "doc-expiry",
            key: reminderKey.docExpiry(d.id, expiresOn, threshold),
            recipients: landlords,
            channels: s.docExpiry,
            notification: docExpiryNotification({
              title: d.title,
              kind: d.kind,
              about: d.tenant?.name ?? d.vendor?.name ?? d.property?.name ?? companyName,
              expiresOn,
              days,
              url: d.propertyId ? `${origin}/dashboard/properties/${d.propertyId}/files` : `${origin}/dashboard/files`,
            }),
          }),
          `document expiring, ${d.title}`
        );
      }
    }
  }
  return report;
}

/**
 * "a $70 late fee was added; $5/day more until paid, up to $120" for the
 * month being chased — from the company policy, or from the tenant's own
 * late rule when they're on their own terms. Nothing when no fee applies.
 */
function lateFeeClause(stmt: StatementResult, month: string): string {
  const rent = stmt.statement.rows.find((r) => r.month === month)?.rent ?? 0;
  const feesSoFar = stmt.lateFeesByMonth[month] ?? 0;
  if (!(rent > 0) || stmt.lateFeeMode === "off") return "";
  // Late fee waivers (a21): a waived month has no late fee to warn about.
  if (stmt.lateFeeWaivers?.some((w) => w.waived && w.month === month)) return "";
  if (stmt.lateFeeMode === "default") return lateFeeSummary({ rent, policy: stmt.policy, feesSoFar });
  const rule = stmt.rules.find((r) => r.kind === "late" && r.active && !r.fromPolicy);
  if (!rule) return "";
  return lateFeeSummary({
    rent,
    policy: {
      enabled: true,
      graceDays: rule.graceDays,
      // A flat fee reads as its share of this month's rent, so the sentence names the dollars.
      percent: rule.percent ? rule.amount : (rule.amount / rent) * 100,
      dailyAmount: rule.dailyAmount ?? 0,
      capPercent: rule.capPercent ?? 0,
    },
    feesSoFar,
  });
}

/* ---------- The moment something happens ---------- */

/**
 * Tell the tenant their repair moved. Called after the landlord's reply or
 * status change is saved; the update's id is the key, so a retried request
 * can't tell them twice.
 */
export async function notifyRepairUpdate(opts: {
  requestId: string;
  updateId: string;
  status: RequestStatus | null;
  note: string;
  origin: string;
}) {
  const request = await prisma.maintenanceRequest.findUnique({
    where: { id: opts.requestId },
    include: {
      tenant: { include: { account: { select: { id: true, email: true } } } },
      property: { select: { companyId: true, company: { select: { name: true } } } },
    },
  });
  if (!request?.tenant || !request.tenant.active) return;
  const companyId = request.property.companyId;
  const s = await settingsFor(companyId);
  if (!s.enabled || !s.maintenance.on) return;
  const status = opts.status ? STATUS_LABEL[opts.status].tenant : "";
  await notify({
    companyId,
    kind: "maintenance",
    key: reminderKey.maintenance(opts.updateId),
    recipients: [tenantRecipient(request.tenant)],
    channels: s.maintenance,
    notification: maintenanceNotification({
      tenantName: request.tenant.name,
      company: request.property.company.name,
      title: request.title,
      body: opts.note || status,
      status,
      url: `${opts.origin}/portal`,
    }),
  });
}

/** A test to the person pressing the button, by one channel. */
export async function sendTest(opts: {
  companyId: string;
  companyName: string;
  user: { id: string; email: string; name: string };
  channel: Channel;
  origin: string;
}): Promise<{ outcome: Outcome; detail: string }> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.reminderSent.count({
    where: { kind: "test", createdAt: { gte: since }, to: { in: [opts.user.email, `user:${opts.user.id}`] } },
  });
  if (recent >= 10) return { outcome: "skipped", detail: "That's plenty of tests for one hour." };
  const key = reminderKey.test(opts.user.id, Date.now());
  const outcome = await deliver({
    companyId: opts.companyId,
    kind: "test",
    key,
    channel: opts.channel,
    recipient: { kind: "user", id: opts.user.id, email: opts.user.email, name: opts.user.name },
    notification: testNotification({ company: opts.companyName, url: `${opts.origin}/dashboard/reminders` }),
  });
  const row = await prisma.reminderSent.findFirst({ where: { key, channel: opts.channel }, select: { detail: true } });
  return { outcome, detail: row?.detail ?? "" };
}
