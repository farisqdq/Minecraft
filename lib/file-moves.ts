import { prisma } from "@/lib/prisma";
import { companyIdsForUser, writableCompanyIds } from "@/lib/access";

/** Rows whose file is still in the public store. */
export const IN_PUBLIC_STORE = { contains: ".public.blob.vercel-storage.com/" };

/**
 * Every file row in the user's LLCs, by table. `writable` narrows it to the
 * LLCs where they may change things (member or owner) — for anything that
 * rewrites rows rather than counting them.
 */
export async function fileScope(userId: string, opts: { writable?: boolean } = {}) {
  const companyIds = opts.writable ? await writableCompanyIds(userId) : await companyIdsForUser(userId);
  return {
    attachment: { transaction: { property: { companyId: { in: companyIds } } } },
    photo: { request: { property: { companyId: { in: companyIds } } } },
    document: { companyId: { in: companyIds } },
  };
}

/**
 * How many of the user's files anyone with the exact link could still open —
 * of those they can move, so a viewer isn't offered a job they can't do.
 */
export async function publicFileCount(userId: string): Promise<number> {
  const where = await fileScope(userId, { writable: true });
  const [attachments, photos, documents] = await Promise.all([
    prisma.attachment.count({ where: { ...where.attachment, url: IN_PUBLIC_STORE } }),
    prisma.maintenancePhoto.count({ where: { ...where.photo, url: IN_PUBLIC_STORE } }),
    prisma.document.count({ where: { ...where.document, url: IN_PUBLIC_STORE } }),
  ]);
  return attachments + photos + documents;
}
