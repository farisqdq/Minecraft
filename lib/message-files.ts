import { prisma } from "@/lib/prisma";
import { BLOB_SETUP_MESSAGE, blobConfigured, inspectUpload } from "@/lib/blob";
import { storeFile } from "@/lib/storage";
import { fileLink } from "@/lib/file-links";
import { attachmentRoom, canStillAttach, type AttachmentDTO } from "@/lib/messages";

/**
 * A file onto a message, from either side. The caller has already checked
 * the thread is theirs; this checks the rest: the message is in that thread
 * and was written by their side, it's still fresh, there's room on it, and
 * the file is a photo or a PDF under 4 MB by its bytes, not its name.
 */
export async function attachToMessage(opts: {
  threadId: string;
  messageId: string;
  fromTenant: boolean;
  file: unknown;
}): Promise<{ attachment: AttachmentDTO } | { error: string; status: number }> {
  const message = await prisma.message.findUnique({
    where: { id: opts.messageId },
    select: { id: true, threadId: true, fromTenant: true, createdAt: true, _count: { select: { attachments: true } } },
  });
  if (!message || message.threadId !== opts.threadId || message.fromTenant !== opts.fromTenant) {
    return { error: "Not found", status: 404 };
  }
  if (!canStillAttach(message.createdAt)) {
    return { error: "That message is too old to add a file to. Send a new one.", status: 400 };
  }
  if (attachmentRoom(message._count.attachments) === 0) {
    return { error: "That's the limit for one message. Send another for more.", status: 400 };
  }
  const file = opts.file;
  if (!(file instanceof File)) return { error: "No file was uploaded.", status: 400 };

  const inspected = await inspectUpload(file);
  if ("error" in inspected) return { error: inspected.error, status: 400 };
  if (!blobConfigured()) return { error: BLOB_SETUP_MESSAGE, status: 503 };

  const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  let stored;
  try {
    // Private storage and a name nobody can guess: these can be photos of
    // the inside of someone's home, or a scan of a document.
    stored = await storeFile(`messages/${opts.threadId}/${safeName}`, file, inspected.contentType);
  } catch (err) {
    console.error("Message attachment upload failed", err);
    return { error: "Couldn't save that file. Try again.", status: 502 };
  }

  const row = await prisma.messageAttachment.create({
    data: {
      messageId: message.id,
      url: stored.url,
      pathname: stored.pathname,
      filename: file.name || safeName,
      contentType: inspected.contentType,
      size: file.size,
    },
  });
  return {
    attachment: {
      id: row.id,
      url: fileLink("message", row.id),
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
    },
  };
}
