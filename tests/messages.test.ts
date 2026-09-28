import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTACH_WINDOW_MS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_CHARS,
  NOTIFY_BUCKET_MS,
  attachmentRoom,
  canStillAttach,
  cleanBody,
  describeAttachments,
  formatSize,
  isUnreadFor,
  messagesLabel,
  notifyBatchId,
  notifyBucket,
  otherSide,
  previewOf,
  sortMessages,
  sortThreads,
  unreadCount,
} from "../lib/messages.ts";

test("a typed message is trimmed, capped and stripped of control characters", () => {
  assert.equal(cleanBody("  hello\r\nthere  "), "hello\nthere", "CRLF becomes LF, ends trimmed");
  assert.equal(cleanBody("a\u0000b\u0007c\td"), "abc\td", "NULs and bells go, tabs stay");
  assert.equal(cleanBody(42), "");
  assert.equal(cleanBody(null), "");
  const long = "x".repeat(MAX_MESSAGE_CHARS + 50);
  assert.equal(cleanBody(long).length, MAX_MESSAGE_CHARS);
  assert.equal(cleanBody("   "), "", "whitespace alone is nothing");
});

test("a message with no words is described by what was attached", () => {
  assert.equal(describeAttachments(["image/jpeg"]), "A photo");
  assert.equal(describeAttachments(["image/jpeg", "image/png"]), "2 photos");
  assert.equal(describeAttachments(["application/pdf"]), "A file");
  assert.equal(describeAttachments(["image/jpeg", "image/heic", "application/pdf"]), "2 photos and a file");
  assert.equal(describeAttachments([]), "");
});

test("a preview is one line, cut at a word, or the attachments when there are no words", () => {
  assert.equal(previewOf("The sink\n\nis   leaking again"), "The sink is leaking again");
  assert.equal(previewOf("", ["image/jpeg"]), "A photo");
  assert.equal(previewOf("", []), "(empty message)");
  const long = "word ".repeat(40).trim();
  const p = previewOf(long, [], 30);
  assert.ok(p.length <= 31, `preview is short: ${p.length}`);
  assert.ok(p.endsWith("…"));
  assert.doesNotMatch(p, /wor…$/, "cuts between words, not through one");
  assert.equal(previewOf("short one", [], 30), "short one");
});

test("unread means from the other side and newer than my stamp", () => {
  const t = (iso: string) => new Date(iso);
  const fromTenant = { fromTenant: true, createdAt: t("2026-09-28T12:00:00Z") };
  const fromLandlord = { fromTenant: false, createdAt: t("2026-09-28T12:05:00Z") };

  // Nobody has read anything yet.
  assert.equal(isUnreadFor(fromTenant, "landlord", null), true);
  assert.equal(isUnreadFor(fromTenant, "tenant", null), false, "your own message is never unread for you");
  assert.equal(isUnreadFor(fromLandlord, "tenant", null), true);
  assert.equal(isUnreadFor(fromLandlord, "landlord", null), false);

  // Read after the tenant wrote, before the landlord replied.
  assert.equal(isUnreadFor(fromTenant, "landlord", t("2026-09-28T12:01:00Z")), false);
  assert.equal(isUnreadFor(fromLandlord, "tenant", t("2026-09-28T12:01:00Z")), true);
  assert.equal(isUnreadFor(fromLandlord, "tenant", "2026-09-28T12:05:00Z"), false, "exactly at the stamp counts as read");
  assert.equal(isUnreadFor(fromLandlord, "tenant", "2026-09-28T12:06:00Z"), false);
});

test("the unread count only counts the other side's newer messages", () => {
  const msgs = [
    { fromTenant: true, createdAt: "2026-09-28T10:00:00Z" },
    { fromTenant: false, createdAt: "2026-09-28T10:30:00Z" },
    { fromTenant: true, createdAt: "2026-09-28T11:00:00Z" },
    { fromTenant: true, createdAt: "2026-09-28T11:30:00Z" },
  ];
  assert.equal(unreadCount(msgs, "landlord", null), 3);
  assert.equal(unreadCount(msgs, "landlord", "2026-09-28T10:45:00Z"), 2);
  assert.equal(unreadCount(msgs, "tenant", null), 1);
  assert.equal(unreadCount(msgs, "tenant", "2026-09-28T10:30:00Z"), 0);
  assert.equal(unreadCount([], "tenant", null), 0);
  assert.equal(otherSide("tenant"), "landlord");
  assert.equal(otherSide("landlord"), "tenant");
});

test("notifications are batched by thread, side and half hour", () => {
  const start = Date.UTC(2026, 8, 28, 14, 0, 0);
  const a = notifyBatchId("th_1", "landlord", start);
  const b = notifyBatchId("th_1", "landlord", start + 10 * 60 * 1000);
  const c = notifyBatchId("th_1", "landlord", start + NOTIFY_BUCKET_MS);
  assert.equal(a, b, "ten minutes later is the same batch");
  assert.notEqual(a, c, "the next half hour is a new batch");
  assert.notEqual(a, notifyBatchId("th_1", "tenant", start), "each side has its own batch");
  assert.notEqual(a, notifyBatchId("th_2", "landlord", start), "each thread has its own batch");
  assert.match(a, /^th_1:landlord:\d+$/);
  assert.equal(notifyBucket(new Date(start)), notifyBucket(start));
  assert.equal(NOTIFY_BUCKET_MS, 30 * 60 * 1000);
});

test("attachment limits: four per message, and only while the message is fresh", () => {
  assert.equal(MAX_ATTACHMENTS_PER_MESSAGE, 4);
  assert.equal(attachmentRoom(0), 4);
  assert.equal(attachmentRoom(3), 1);
  assert.equal(attachmentRoom(4), 0);
  assert.equal(attachmentRoom(9), 0);

  const sent = Date.UTC(2026, 8, 28, 9, 0, 0);
  assert.equal(canStillAttach(new Date(sent), sent + 5000), true);
  assert.equal(canStillAttach(new Date(sent).toISOString(), sent + ATTACH_WINDOW_MS), true);
  assert.equal(canStillAttach(new Date(sent), sent + ATTACH_WINDOW_MS + 1), false, "too late");
  assert.equal(canStillAttach("garbage", sent), false);
});

test("sizes and labels read like a person wrote them", () => {
  assert.equal(formatSize(0), "");
  assert.equal(formatSize(900), "900 B");
  assert.equal(formatSize(320_000), "313 KB");
  assert.equal(formatSize(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(messagesLabel(0), "Messages");
  assert.equal(messagesLabel(3), "Messages (3 unread)");
});

test("threads sort newest first and messages oldest first", () => {
  const threads = [{ lastMessageAt: "2026-09-01T00:00:00Z" }, { lastMessageAt: "2026-09-20T00:00:00Z" }];
  assert.deepEqual(
    sortThreads(threads).map((t) => t.lastMessageAt),
    ["2026-09-20T00:00:00Z", "2026-09-01T00:00:00Z"]
  );
  const msgs = [{ createdAt: "2026-09-20T00:00:00Z" }, { createdAt: "2026-09-01T00:00:00Z" }];
  assert.deepEqual(sortMessages(msgs).map((m) => m.createdAt), ["2026-09-01T00:00:00Z", "2026-09-20T00:00:00Z"]);
  assert.equal(threads[0].lastMessageAt, "2026-09-01T00:00:00Z", "the input is not reordered");
});
