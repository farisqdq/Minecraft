/**
 * Messaging between a tenant and their landlord's company: the rules that
 * need no database. One thread per tenant; each side has a read stamp; a
 * message from the other side newer than your stamp is unread.
 *
 * Pure so it can be tested with the Node test runner. Relative imports only.
 */

/** Which end of the conversation someone is on. */
export type Side = "tenant" | "landlord";

/** The most one message can carry. Each file is checked by lib/blob on the way in. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

/** As long as a repair report's detail; anything longer is a document. */
export const MAX_MESSAGE_CHARS = 4000;

/**
 * A ceiling on what one tenant can send, so a compromised or angry account
 * can't bury the inbox. The same figure lib/maintenance uses for replies on
 * a repair, and far above anything a real conversation does.
 */
export const MAX_TENANT_MESSAGES_PER_HOUR = 30;

/**
 * How long a burst of messages is folded into one notification. The first
 * message in a half hour goes out by email and push; the rest of that half
 * hour ride on it, and the count says how many are waiting.
 */
export const NOTIFY_BUCKET_MS = 30 * 60 * 1000;

/**
 * A message may still take attachments this long after it was sent. It
 * closes the door on appending files to an old message later on.
 */
export const ATTACH_WINDOW_MS = 10 * 60 * 1000;

export type AttachmentDTO = {
  id: string;
  /** Always an /api/files link, never the storage URL. */
  url: string;
  filename: string;
  contentType: string;
  size: number;
};

export type MessageDTO = {
  id: string;
  fromTenant: boolean;
  authorName: string;
  body: string;
  createdAt: string;
  attachments: AttachmentDTO[];
};

export type ThreadDTO = {
  id: string;
  tenantId: string;
  tenantName: string;
  propertyId: string;
  propertyName: string;
  unitName: string;
  companyName: string;
  lastMessageAt: string;
  tenantReadAt: string;
  landlordReadAt: string;
  messages: MessageDTO[];
};

/** One line of the landlord's inbox. */
export type InboxRowDTO = {
  threadId: string;
  tenantId: string;
  tenantName: string;
  tenantActive: boolean;
  propertyId: string;
  propertyName: string;
  unitName: string;
  lastMessageAt: string;
  lastFromTenant: boolean;
  preview: string;
  unread: number;
};

/* ---------- Text ---------- */

/**
 * What's kept of a typed message: trimmed, control characters out (line
 * breaks and tabs stay — people write in paragraphs), capped in length.
 */
export function cleanBody(value: unknown, max = MAX_MESSAGE_CHARS): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max)
    .trim();
}

/** "1 photo", "3 files", "2 photos and a PDF" — what a message with no words was. */
export function describeAttachments(contentTypes: string[]): string {
  const photos = contentTypes.filter((t) => t.startsWith("image/")).length;
  const files = contentTypes.length - photos;
  const parts: string[] = [];
  if (photos > 0) parts.push(photos === 1 ? "a photo" : `${photos} photos`);
  if (files > 0) parts.push(files === 1 ? "a file" : `${files} files`);
  if (parts.length === 0) return "";
  const text = parts.join(" and ");
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * One line for an inbox row or a notification: the first words of the
 * message, or what was attached when there were none.
 */
export function previewOf(body: string, contentTypes: string[] = [], max = 90): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (!oneLine) return describeAttachments(contentTypes) || "(empty message)";
  if (oneLine.length <= max) return oneLine;
  const cut = oneLine.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/* ---------- Attachments ---------- */

export function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/** How many more files a message can take. */
export function attachmentRoom(already: number): number {
  return Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - already);
}

/** Whether a message is still fresh enough to take another file. */
export function canStillAttach(messageCreatedAt: Date | string, now: Date | number = Date.now()): boolean {
  const created = new Date(messageCreatedAt).getTime();
  const at = typeof now === "number" ? now : now.getTime();
  return Number.isFinite(created) && at - created <= ATTACH_WINDOW_MS && at >= created - 60_000;
}

/** "312 KB", for a file link. */
export function formatSize(bytes: number): string {
  if (!(bytes > 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------- Read tracking ---------- */

type Stamped = { fromTenant: boolean; createdAt: Date | string };

const ms = (d: Date | string | null | undefined) => {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Whether this message is one `side` hasn't read: from the other side, and newer than the stamp. */
export function isUnreadFor(message: Stamped, side: Side, readAt: Date | string | null | undefined): boolean {
  const fromOtherSide = side === "landlord" ? message.fromTenant : !message.fromTenant;
  return fromOtherSide && ms(message.createdAt) > ms(readAt);
}

/** How many of these messages `side` hasn't read. */
export function unreadCount(messages: Stamped[], side: Side, readAt: Date | string | null | undefined): number {
  return messages.filter((m) => isUnreadFor(m, side, readAt)).length;
}

/** The other end of the conversation, for who to tell. */
export function otherSide(side: Side): Side {
  return side === "tenant" ? "landlord" : "tenant";
}

/* ---------- Notification batching ---------- */

/** Which half-hour a moment falls in, counted from the epoch. */
export function notifyBucket(at: Date | number = Date.now()): number {
  const t = typeof at === "number" ? at : at.getTime();
  return Math.floor(t / NOTIFY_BUCKET_MS);
}

/**
 * The thing a message notification is "about", for the once-only log in
 * lib/reminders-db: this thread, this side of it, this half hour. Every
 * message in the same half hour to the same side gets the same id, so the
 * second one is a duplicate and nobody's phone buzzes thirty times for a
 * thirty-line conversation. Passed to reminderKey.message().
 */
export function notifyBatchId(threadId: string, to: Side, at: Date | number = Date.now()): string {
  return `${threadId}:${to}:${notifyBucket(at)}`;
}

/* ---------- Ordering ---------- */

/** Newest activity first, for the inbox. */
export function sortThreads<T extends { lastMessageAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

/** Oldest first, for reading a thread top to bottom. */
export function sortMessages<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** "Messages" or "Messages (3 unread)", for a link on a tenant card. */
export function messagesLabel(unread: number): string {
  return unread > 0 ? `Messages (${unread} unread)` : "Messages";
}
