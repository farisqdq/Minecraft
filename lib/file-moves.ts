import { prisma } from "@/lib/prisma";
import { companyIdsForUser } from "@/lib/access";

/** Rows whose file is still in the public store. */
export const IN_PUBLIC_STORE = { contains: ".public.blob.vercel-storage.com/" };

/** Every file row in the user's LLCs, by table. */
export async function fileScope(userId: string) {
  const companyIds = await companyIdsForUser(userId);
  return {
    attachment: { transaction: { property: { companyId: { in: companyIds } } } },
    photo: { request: { property: { companyId: { in: companyIds } } } },
    document: { companyId: { in: companyIds } },
  };
}

/** How many of the user's files anyone with the exact link could still open. */
export async function publicFileCount(userId: string): Promise<number> {
  const where = await fileScope(userId);
  const [attachments, photos, documents] = await Promise.all([
    prisma.attachment.count({ where: { ...where.attachment, url: IN_PUBLIC_STORE } }),
    prisma.maintenancePhoto.count({ where: { ...where.photo, url: IN_PUBLIC_STORE } }),
    prisma.document.count({ where: { ...where.document, url: IN_PUBLIC_STORE } }),
  ]);
  return attachments + photos + documents;
}
