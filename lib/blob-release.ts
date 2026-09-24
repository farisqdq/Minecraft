import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";
import { storageAccessOf } from "@/lib/file-links";

/**
 * Remove a stored file — but only when nothing else still points at it.
 *
 * A backup file is just JSON, and its file links are whatever it says they
 * are. Someone could import a backup whose receipt link is the URL of
 * another landlord's lease, then delete that receipt: without this check,
 * the server would delete the other landlord's file with its own storage
 * credentials. Counting every row that references the URL, across every
 * account, means a file shared with anyone else is left alone.
 *
 * Call it after the row that owned the link has been deleted, so that row
 * is no longer counted. Returns whether the file was removed.
 */
export async function releaseBlob(url: string): Promise<boolean> {
  if (!url || !storageAccessOf(url)) return false;
  if ((await blobReferences(url)) > 0) return false;
  await deleteFile(url);
  return true;
}

/** How many rows, in any account, still link to this stored file. */
export async function blobReferences(url: string): Promise<number> {
  const [attachments, photos, documents] = await Promise.all([
    prisma.attachment.count({ where: { url } }),
    prisma.maintenancePhoto.count({ where: { url } }),
    prisma.document.count({ where: { url } }),
  ]);
  return attachments + photos + documents;
}
