"use client";

import type { AttachmentDTO, MessageDTO } from "@/lib/messages";

/**
 * Sending a message from either side is the same two steps: the words go
 * up as JSON and come back as a message, then each file goes up against
 * that message. A file that fails doesn't lose the message — the words are
 * already there — and the caller is told how many didn't make it.
 */
export async function sendMessage(opts: {
  createUrl: string;
  attachUrl: string;
  body: string;
  files: File[];
}): Promise<{ message: MessageDTO; failed: string[] } | { error: string }> {
  const res = await fetch(opts.createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: opts.body, attachments: opts.files.length }),
  });
  const created = await res.json().catch(() => null);
  if (!res.ok || !created?.id) return { error: created?.error || "Couldn't send that." };

  let message: MessageDTO = { ...created, attachments: created.attachments ?? [] };
  const failed: string[] = [];
  for (const file of opts.files) {
    const data = new FormData();
    data.append("messageId", message.id);
    data.append("file", file);
    const up = await fetch(opts.attachUrl, { method: "POST", body: data }).catch(() => null);
    const attachment: AttachmentDTO | null = up ? await up.json().catch(() => null) : null;
    if (up?.ok && attachment?.id) message = { ...message, attachments: [...message.attachments, attachment] };
    else failed.push(attachment && "error" in attachment ? String((attachment as { error: string }).error) : file.name);
  }
  return { message, failed };
}

/** The custom event the shells listen for, so a badge drops the moment a thread is read. */
export const MESSAGES_READ_EVENT = "rentroll:messages-read";

export function announceMessagesRead() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
}
