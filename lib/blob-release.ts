import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { blobConfigured } from "@/lib/blob";

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
  if (!url || !blobConfigured()) return false;
  if ((await blobReferences(url)) > 0) return false;
  await del(url).catch(() => undefined);
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

/**
 * Whether a link from a backup file points at Vercel Blob storage, the only
 * place this app ever stores files. Anything else — another website, a
 * tracking pixel, a phishing page — is dropped on import rather than shown
 * as a receipt or a lease.
 */
export function isBlobUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /\.public\.blob\.vercel-storage\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}
