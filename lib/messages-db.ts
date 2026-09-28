import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fileLink } from "@/lib/file-links";
import { landlordRecipients, notify, tenantRecipient } from "@/lib/reminders-db";
import { messageNotification, reminderKey } from "@/lib/reminders";
import {
  notifyBatchId,
  previewOf,
  unreadCount,
  type InboxRowDTO,
  type MessageDTO,
  type Side,
  type ThreadDTO,
} from "@/lib/messages";

/**
 * The database half of messaging. Every function here takes a tenant id
 * the caller has already checked — the portal's from its session, the
 * landlord's through requireTenant — and never widens it.
 */

export const messageInclude = {
  attachments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.MessageInclude;

export const threadInclude = {
  tenant: {
    select: {
      id: true,
      name: true,
      active: true,
      propertyId: true,
      property: { select: { name: true, company: { select: { name: true } } } },
      unit: { select: { name: true } },
    },
  },
  messages: { orderBy: { createdAt: "asc" }, include: messageInclude },
} satisfies Prisma.MessageThreadInclude;

/** Not called: it pins `ThreadRow` to whatever `threadInclude` pulls. */
async function shapeOfThread(id: string) {
  return prisma.messageThread.findUnique({ where: { id }, include: threadInclude });
}
type ThreadRow = NonNullable<Awaited<ReturnType<typeof shapeOfThread>>>;
type MessageRow = ThreadRow["messages"][number];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/**
 * A message as each side sees it. The tenant's copy signs everything from
 * the landlord's side with the company's name: a team member's account
 * name is a first name or an email address, which is theirs to keep.
 */
export function serializeMessage(m: MessageRow, audience: Side, companyName: string): MessageDTO {
  return {
    id: m.id,
    fromTenant: m.fromTenant,
    authorName: audience === "tenant" && !m.fromTenant ? companyName || "Your landlord" : m.authorName,
    body: m.body,
    createdAt: iso(m.createdAt),
    attachments: m.attachments.map((a) => ({
      id: a.id,
      url: fileLink("message", a.id),
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
  };
}

export function serializeThread(t: ThreadRow, audience: Side): ThreadDTO {
  const companyName = t.tenant.property.company.name;
  return {
    id: t.id,
    tenantId: t.tenantId,
    tenantName: t.tenant.name,
    propertyId: t.tenant.propertyId,
    propertyName: t.tenant.property.name,
    unitName: t.tenant.unit?.name ?? "",
    companyName,
    lastMessageAt: iso(t.lastMessageAt),
    tenantReadAt: iso(t.tenantReadAt),
    landlordReadAt: iso(t.landlordReadAt),
    messages: t.messages.map((m) => serializeMessage(m, audience, companyName)),
  };
}

/** A thread that hasn't been started yet, so a page can render before the first message. */
export async function emptyThreadFor(tenantId: string): Promise<ThreadDTO | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      propertyId: true,
      property: { select: { name: true, company: { select: { name: true } } } },
      unit: { select: { name: true } },
    },
  });
  if (!t) return null;
  return {
    id: "",
    tenantId: t.id,
    tenantName: t.name,
    propertyId: t.propertyId,
    propertyName: t.property.name,
    unitName: t.unit?.name ?? "",
    companyName: t.property.company.name,
    lastMessageAt: "",
    tenantReadAt: "",
    landlordReadAt: "",
    messages: [],
  };
}

/** The tenant's thread with everything in it, or an empty one if nobody has written yet. */
export async function threadForTenant(tenantId: string, audience: Side): Promise<ThreadDTO | null> {
  const row = await prisma.messageThread.findUnique({ where: { tenantId }, include: threadInclude });
  return row ? serializeThread(row, audience) : emptyThreadFor(tenantId);
}

/**
 * The thread row for a tenant, made on first use. The company is read off
 * the tenant's property, never taken from a request.
 */
export async function ensureThread(tenantId: string) {
  const existing = await prisma.messageThread.findUnique({ where: { tenantId } });
  if (existing) return existing;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { property: { select: { companyId: true } } },
  });
  if (!tenant) return null;
  // Two first messages at once: the unique on tenantId makes the second
  // create fail, and the read after it finds the winner.
  return prisma.messageThread
    .create({ data: { tenantId, companyId: tenant.property.companyId } })
    .catch(() => prisma.messageThread.findUnique({ where: { tenantId } }));
}

/** Append a message and move the thread to the top of the inbox. */
export async function postMessage(opts: {
  threadId: string;
  fromTenant: boolean;
  authorName: string;
  authorUserId?: string | null;
  body: string;
}) {
  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        threadId: opts.threadId,
        fromTenant: opts.fromTenant,
        authorName: opts.authorName,
        authorUserId: opts.authorUserId ?? null,
        body: opts.body,
        createdAt: now,
      },
      include: messageInclude,
    }),
    prisma.messageThread.update({
      where: { id: opts.threadId },
      // Your own message counts as read by you: the stamp moves with it, so
      // replying never leaves your own line "unread".
      data: opts.fromTenant
        ? { lastMessageAt: now, tenantReadAt: now }
        : { lastMessageAt: now, landlordReadAt: now },
    }),
  ]);
  return message;
}

/** How many messages this tenant sent in the last hour, for the throttle. */
export async function tenantMessagesLastHour(threadId: string) {
  return prisma.message.count({
    where: { threadId, fromTenant: true, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
}

export async function markRead(threadId: string, side: Side) {
  await prisma.messageThread.update({
    where: { id: threadId },
    data: side === "tenant" ? { tenantReadAt: new Date() } : { landlordReadAt: new Date() },
  });
}

/* ---------- Unread counts ---------- */

/** What the tenant hasn't read of the landlord's side. */
export async function tenantUnread(tenantId: string): Promise<number> {
  const thread = await prisma.messageThread.findUnique({
    where: { tenantId },
    select: { id: true, tenantReadAt: true, lastMessageAt: true },
  });
  if (!thread) return 0;
  // Cheap early out: nothing has happened since they last looked.
  if (thread.tenantReadAt && thread.lastMessageAt <= thread.tenantReadAt) return 0;
  return prisma.message.count({
    where: { threadId: thread.id, fromTenant: false, createdAt: { gt: thread.tenantReadAt ?? new Date(0) } },
  });
}

/**
 * Unread tenant messages per thread, across every company this landlord
 * is on. Only threads with activity since the team last looked are asked
 * about, which is nearly always a handful.
 */
export async function landlordUnreadByThread(where: Prisma.MessageThreadWhereInput): Promise<Map<string, number>> {
  const threads = await prisma.messageThread.findMany({
    where,
    select: { id: true, landlordReadAt: true, lastMessageAt: true },
  });
  const stale = threads.filter((t) => !t.landlordReadAt || t.lastMessageAt > t.landlordReadAt);
  if (stale.length === 0) return new Map();
  const groups = await prisma.message.groupBy({
    by: ["threadId"],
    where: {
      fromTenant: true,
      OR: stale.map((t) => ({ threadId: t.id, createdAt: { gt: t.landlordReadAt ?? new Date(0) } })),
    },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.threadId, g._count._all]));
}

const forUser = (userId: string): Prisma.MessageThreadWhereInput => ({
  company: { members: { some: { userId } } },
});

/** The number on the Messages tab. */
export async function landlordUnreadTotal(userId: string): Promise<number> {
  let total = 0;
  for (const n of (await landlordUnreadByThread(forUser(userId))).values()) total += n;
  return total;
}

/** Unread counts keyed by tenant, for the cards on a property page. */
export async function unreadByTenantForProperty(propertyId: string): Promise<Record<string, number>> {
  const threads = await prisma.messageThread.findMany({
    where: { tenant: { propertyId } },
    select: { id: true, tenantId: true },
  });
  if (threads.length === 0) return {};
  const counts = await landlordUnreadByThread({ tenant: { propertyId } });
  const out: Record<string, number> = {};
  for (const t of threads) {
    const n = counts.get(t.id) ?? 0;
    if (n > 0) out[t.tenantId] = n;
  }
  return out;
}

/** Every conversation this landlord can see, newest activity first. */
export async function inboxFor(userId: string): Promise<InboxRowDTO[]> {
  const rows = await prisma.messageThread.findMany({
    where: forUser(userId),
    orderBy: { lastMessageAt: "desc" },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          active: true,
          propertyId: true,
          property: { select: { name: true } },
          unit: { select: { name: true } },
        },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { attachments: { select: { contentType: true } } } },
    },
  });
  const unread = await landlordUnreadByThread(forUser(userId));
  return rows.map((t) => {
    const last = t.messages[0];
    return {
      threadId: t.id,
      tenantId: t.tenantId,
      tenantName: t.tenant.name,
      tenantActive: t.tenant.active,
      propertyId: t.tenant.propertyId,
      propertyName: t.tenant.property.name,
      unitName: t.tenant.unit?.name ?? "",
      lastMessageAt: iso(t.lastMessageAt),
      lastFromTenant: last?.fromTenant ?? false,
      preview: last ? previewOf(last.body, last.attachments.map((a) => a.contentType)) : "",
      unread: unread.get(t.id) ?? 0,
    };
  });
}

/* ---------- Telling the other side ---------- */

/**
 * Email and push the side that didn't write. Batched: the once-only log in
 * lib/reminders-db is keyed by thread, recipient side and half hour, so a
 * burst of messages costs the other side one notification, whose count says
 * how much is waiting. Called after the response, via after().
 */
export async function notifyNewMessage(opts: {
  threadId: string;
  fromTenant: boolean;
  origin: string;
  /** Files the sender said were on their way; they land after this runs. */
  pendingFiles?: number;
}) {
  const thread = await prisma.messageThread.findUnique({
    where: { id: opts.threadId },
    include: {
      tenant: {
        include: {
          account: { select: { id: true, email: true } },
          property: { select: { company: { select: { name: true } } } },
        },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 60, include: { attachments: { select: { contentType: true } } } },
    },
  });
  if (!thread) return;
  const to: Side = opts.fromTenant ? "landlord" : "tenant";
  const readAt = to === "landlord" ? thread.landlordReadAt : thread.tenantReadAt;
  const count = Math.max(1, unreadCount(thread.messages, to, readAt));
  const latest = thread.messages.find((m) => m.fromTenant === opts.fromTenant);
  if (!latest) return;
  const pending = opts.pendingFiles ?? 0;
  const preview =
    !latest.body.trim() && latest.attachments.length === 0 && pending > 0
      ? pending === 1
        ? "Sent a photo or file"
        : `Sent ${pending} photos or files`
      : previewOf(latest.body, latest.attachments.map((a) => a.contentType), 200);
  const companyName = thread.tenant.property.company.name;

  const recipients = to === "landlord" ? await landlordRecipients(thread.companyId) : [tenantRecipient(thread.tenant)];
  // A tenant who has moved out can't open the portal, so there's no point
  // telling them; the team still hears from a past tenant.
  if (to === "tenant" && !thread.tenant.active) return;

  await notify({
    companyId: thread.companyId,
    kind: "message",
    key: reminderKey.message(notifyBatchId(thread.id, to)),
    recipients,
    channels: { email: true, push: true },
    notification: messageNotification({
      // The tenant is told the company wrote, never which person.
      from: to === "landlord" ? thread.tenant.name : companyName || "Your landlord",
      preview,
      count,
      url: to === "landlord" ? `${opts.origin}/dashboard/messages/${thread.tenantId}` : `${opts.origin}/portal#messages`,
    }),
  });
}
